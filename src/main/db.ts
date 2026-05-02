import { app } from "electron";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve as resolvePath } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { providerApiKeyFingerprint } from "../shared/providerValidation";
import type {
  AppSettings,
  AssetRecord,
  Character,
  GlobalCharacterGalleryItem,
  GlobalLibraryImage,
  ProviderConfig,
  ProjectInput,
  ProjectRecord,
  ProjectWithThumbnail,
  ProjectWorkspace,
  Scene,
  TranscriptRow,
} from "@shared/types";

const supportedProviderNames: ProviderConfig["name"][] = [
  "openai",
  "gemini",
  "fal",
  "elevenlabs",
];

const defaultSettings: AppSettings = {
  language: "en",
  providers: [],
  elevenLabsVoiceId: "d5HVupAWCwe4e6GvMCAL",
  providerModels: {},
  falModelCategories: {},
  taskModelMappings: {
    generateScript: { provider: "openai", model: "gpt-5-mini" },
    generateImage: { provider: "fal", model: "fal-ai/flux/schnell" },
    generateVideo: { provider: "openai", model: "veo-3" },
    textToSpeech: { provider: "elevenlabs", model: "eleven-v3" },
  },
  generationEnabled: {
    generateImage: true,
    generateVideo: true,
  },
  enablePromptCalibration: false,
  enableEndFramePrompts: false,
  providerValidation: {},
};

interface Step1OutputRecord {
  id: string;
  projectId: string;
  rawResponse: string;
  normalizedJson: string;
  version: number;
  createdAt: string;
}

interface AppData {
  settings: AppSettings;
  projects: ProjectRecord[];
  globalCharacterLibrary: GlobalLibraryImage[];
}

interface ProjectData {
  step1Outputs: Step1OutputRecord[];
  characters: Character[];
  scenes: Scene[];
  transcripts: TranscriptRow[];
  assets: AssetRecord[];
}

let dataStore: AppData | null = null;
let dataFilePath = "";
let secretFilePath = "";
let secretKey: Buffer | null = null;
const projectStore = new Map<string, ProjectData>();

function nowIso(): string {
  return new Date().toISOString();
}

function defaultData(): AppData {
  return {
    settings: defaultSettings,
    projects: [],
    globalCharacterLibrary: [],
  };
}

function normalizeProjectRecord(project: ProjectRecord): ProjectRecord {
  const normalizedStatusDetail =
    project.status === "error"
      ? project.statusDetail?.trim() || "Unknown generation error"
      : project.status === "processing"
        ? (project.statusDetail?.trim() ?? null)
        : null;
  return {
    ...project,
    deliveryProfile: project.deliveryProfile ?? "short_form",
    projectMode: project.projectMode ?? "pipeline",
    logline: project.logline ?? null,
    theme: project.theme ?? null,
    statusDetail: normalizedStatusDetail,
    archivedAt: project.archivedAt ?? null,
  };
}

function normalizeCharacterRow(character: Character): Character {
  return {
    ...character,
    negativeConsistency: character.negativeConsistency ?? null,
  };
}

function normalizeSceneRow(scene: Scene): Scene {
  return {
    ...scene,
    shotSize: scene.shotSize ?? null,
    ambientSound: scene.ambientSound ?? null,
    soundEffect: scene.soundEffect ?? null,
    dialogueCue: scene.dialogueCue ?? null,
    endFramePrompt: scene.endFramePrompt ?? null,
    needsEndFrame: scene.needsEndFrame ?? null,
  };
}

function defaultProjectData(): ProjectData {
  return {
    step1Outputs: [],
    characters: [],
    scenes: [],
    transcripts: [],
    assets: [],
  };
}

function resolveDataFilePath(): string {
  const baseDir = app.isPackaged
    ? join(app.getPath("userData"), "data")
    : join(process.cwd(), "data");
  mkdirSync(baseDir, { recursive: true });
  return join(baseDir, "ai-creator.json");
}

function resolveProjectsRootDir(): string {
  const baseDir = app.isPackaged
    ? join(app.getPath("userData"), "data")
    : join(process.cwd(), "data");
  const projectsDir = join(baseDir, "projects");
  mkdirSync(projectsDir, { recursive: true });
  return projectsDir;
}

function getProjectDataDir(projectId: string): string {
  const directory = join(resolveProjectsRootDir(), projectId);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function getProjectDataFilePath(projectId: string): string {
  return join(getProjectDataDir(projectId), "project-data.json");
}

function resolveSecretFilePath(): string {
  const baseDir = app.isPackaged
    ? join(app.getPath("userData"), "data")
    : join(process.cwd(), "data");
  mkdirSync(baseDir, { recursive: true });
  return join(baseDir, "secret.key");
}

function loadOrCreateSecretKey(): Buffer {
  if (secretKey) {
    return secretKey;
  }

  if (!secretFilePath) {
    secretFilePath = resolveSecretFilePath();
  }

  if (!existsSync(secretFilePath)) {
    const generated = randomBytes(32).toString("base64");
    writeFileSync(secretFilePath, generated, "utf8");
    secretKey = Buffer.from(generated, "base64");
    return secretKey;
  }

  const raw = readFileSync(secretFilePath, "utf8").trim();
  const parsed = Buffer.from(raw, "base64");
  if (parsed.length !== 32) {
    const generated = randomBytes(32).toString("base64");
    writeFileSync(secretFilePath, generated, "utf8");
    secretKey = Buffer.from(generated, "base64");
    return secretKey;
  }

  secretKey = parsed;
  return secretKey;
}

function encryptSecret(plainText: string): string {
  if (!plainText) {
    return "";
  }
  const key = loadOrCreateSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

function decryptSecret(encoded: string): string {
  if (!encoded) {
    return "";
  }
  if (!encoded.startsWith("enc:v1:")) {
    return encoded;
  }
  const payload = Buffer.from(encoded.slice("enc:v1:".length), "base64");
  if (payload.length < 12 + 16) {
    return "";
  }
  const key = loadOrCreateSecretKey();
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const data = payload.subarray(28);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

function normalizeProviderValidationField(
  raw: AppSettings["providerValidation"],
): AppSettings["providerValidation"] {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const out: NonNullable<AppSettings["providerValidation"]> = {};
  for (const name of supportedProviderNames) {
    const e = raw[name];
    if (
      e &&
      typeof e === "object" &&
      typeof e.validatedAt === "string" &&
      typeof e.apiKeyFingerprint === "string"
    ) {
      out[name] = {
        validatedAt: e.validatedAt,
        apiKeyFingerprint: e.apiKeyFingerprint,
      };
    }
  }
  return out;
}

function decodeSettings(settings: AppSettings): AppSettings {
  const decodedProviders = settings.providers.map((provider) => ({
    ...provider,
    apiKey: decryptSecret(provider.apiKey ?? ""),
  }));

  return {
    ...settings,
    providers: decodedProviders,
    elevenLabsVoiceId:
      (settings.elevenLabsVoiceId ?? "").trim() ||
      defaultSettings.elevenLabsVoiceId,
    enablePromptCalibration:
      settings.enablePromptCalibration ??
      defaultSettings.enablePromptCalibration,
    enableEndFramePrompts:
      settings.enableEndFramePrompts ?? defaultSettings.enableEndFramePrompts,
    providerValidation: normalizeProviderValidationField(settings.providerValidation),
  };
}

function encodeSettings(settings: AppSettings): AppSettings {
  const encodedProviders = settings.providers.map((provider) => ({
    ...provider,
    apiKey: encryptSecret((provider.apiKey ?? "").trim()),
  }));

  return {
    ...settings,
    providers: encodedProviders,
    elevenLabsVoiceId:
      (settings.elevenLabsVoiceId ?? "").trim() ||
      defaultSettings.elevenLabsVoiceId,
  };
}

function normalizeTaskModelMappings(
  rawMappings: unknown,
): AppSettings["taskModelMappings"] {
  const defaults = defaultSettings.taskModelMappings;
  const candidate =
    rawMappings && typeof rawMappings === "object"
      ? (rawMappings as Partial<AppSettings["taskModelMappings"]>)
      : {};

  const normalized = { ...defaults };
  (
    Object.keys(defaults) as Array<keyof AppSettings["taskModelMappings"]>
  ).forEach((task) => {
    const mapping = candidate[task];
    if (!mapping || typeof mapping !== "object") {
      return;
    }

    const provider = "provider" in mapping ? mapping.provider : undefined;
    const model = "model" in mapping ? mapping.model : undefined;
    if (
      typeof provider === "string" &&
      supportedProviderNames.includes(provider as ProviderConfig["name"]) &&
      typeof model === "string" &&
      model.trim()
    ) {
      normalized[task] = {
        provider: provider as ProviderConfig["name"],
        model: model.trim(),
      };
    }
  });

  return normalized;
}

function saveData(): void {
  if (!dataStore) {
    return;
  }
  writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2), "utf8");
}

function saveProjectData(projectId: string, projectData: ProjectData): void {
  const filePath = getProjectDataFilePath(projectId);
  writeFileSync(filePath, JSON.stringify(projectData, null, 2), "utf8");
  projectStore.set(projectId, projectData);
}

function loadProjectData(projectId: string): ProjectData {
  const cached = projectStore.get(projectId);
  if (cached) {
    return cached;
  }

  const filePath = getProjectDataFilePath(projectId);
  if (!existsSync(filePath)) {
    const initial = defaultProjectData();
    saveProjectData(projectId, initial);
    return initial;
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ProjectData>;
  const normalized: ProjectData = {
    step1Outputs: parsed.step1Outputs ?? [],
    characters: (parsed.characters ?? []).map((row) =>
      normalizeCharacterRow(row as Character),
    ),
    scenes: (parsed.scenes ?? []).map((row) => normalizeSceneRow(row as Scene)),
    transcripts: (parsed.transcripts ?? []).map((row) => ({
      ...row,
      voiceId: row.voiceId ?? "",
    })),
    assets: parsed.assets ?? [],
  };
  projectStore.set(projectId, normalized);
  return normalized;
}

function migrateLegacyProjectData(
  parsed: any,
  projects: ProjectRecord[],
): void {
  const legacyStep1Outputs = Array.isArray(parsed.step1Outputs)
    ? (parsed.step1Outputs as Step1OutputRecord[])
    : [];
  const legacyCharacters = Array.isArray(parsed.characters)
    ? (parsed.characters as Character[])
    : [];
  const legacyScenes = Array.isArray(parsed.scenes)
    ? (parsed.scenes as Scene[])
    : [];
  const legacyTranscripts = Array.isArray(parsed.transcripts)
    ? (parsed.transcripts as TranscriptRow[])
    : [];
  const legacyAssets = Array.isArray(parsed.assets)
    ? (parsed.assets as AssetRecord[])
    : [];

  if (
    legacyStep1Outputs.length === 0 &&
    legacyCharacters.length === 0 &&
    legacyScenes.length === 0 &&
    legacyTranscripts.length === 0 &&
    legacyAssets.length === 0
  ) {
    return;
  }

  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const merged: ProjectData = {
      step1Outputs: [
        ...projectData.step1Outputs,
        ...legacyStep1Outputs.filter((item) => item.projectId === project.id),
      ],
      characters: [
        ...projectData.characters,
        ...legacyCharacters.filter((item) => item.projectId === project.id),
      ],
      scenes: [
        ...projectData.scenes,
        ...legacyScenes.filter((item) => item.projectId === project.id),
      ],
      transcripts: [
        ...projectData.transcripts,
        ...legacyTranscripts.filter((item) => item.projectId === project.id),
      ],
      assets: [
        ...projectData.assets,
        ...legacyAssets.filter((item) => item.projectId === project.id),
      ],
    };
    saveProjectData(project.id, merged);
  }
}

function loadData(): AppData {
  if (dataStore) {
    return dataStore;
  }

  dataFilePath = resolveDataFilePath();
  if (!existsSync(dataFilePath)) {
    dataStore = defaultData();
    saveData();
    return dataStore;
  }

  const raw = readFileSync(dataFilePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AppData> & Record<string, unknown>;
  const projects = (parsed.projects ?? []).map((project) =>
    normalizeProjectRecord(project as ProjectRecord),
  );
  const parsedProvidersRaw = parsed.settings?.providers;
  const parsedProviderKeys = (
    parsed.settings as { providerKeys?: Record<string, string> } | undefined
  )?.providerKeys;

  const providersFromRecords: ProviderConfig[] = Array.isArray(
    parsedProvidersRaw,
  )
    ? parsedProvidersRaw.flatMap((provider) => {
        if (
          provider &&
          typeof provider === "object" &&
          "name" in provider &&
          "apiKey" in provider &&
          typeof provider.name === "string" &&
          typeof provider.apiKey === "string" &&
          supportedProviderNames.includes(
            provider.name as ProviderConfig["name"],
          )
        ) {
          return [
            {
              name: provider.name as ProviderConfig["name"],
              apiKey: provider.apiKey,
            },
          ];
        }
        return [];
      })
    : [];

  const providersFromLegacyNames: ProviderConfig[] = Array.isArray(
    parsedProvidersRaw,
  )
    ? parsedProvidersRaw.flatMap((providerName) => {
        if (
          typeof providerName !== "string" ||
          !supportedProviderNames.includes(
            providerName as ProviderConfig["name"],
          )
        ) {
          return [];
        }
        return [
          {
            name: providerName as ProviderConfig["name"],
            apiKey: parsedProviderKeys?.[providerName] ?? "",
          },
        ];
      })
    : [];

  const providersFromLegacyKeys: ProviderConfig[] = parsedProviderKeys
    ? Object.entries(parsedProviderKeys).flatMap(([providerName, apiKey]) => {
        if (
          !supportedProviderNames.includes(
            providerName as ProviderConfig["name"],
          )
        ) {
          return [];
        }
        return [
          {
            name: providerName as ProviderConfig["name"],
            apiKey: apiKey ?? "",
          },
        ];
      })
    : [];

  const dedupedProvidersByName = new Map<
    ProviderConfig["name"],
    ProviderConfig
  >();
  [
    ...providersFromLegacyKeys,
    ...providersFromLegacyNames,
    ...providersFromRecords,
  ].forEach((provider) => {
    dedupedProvidersByName.set(provider.name, provider);
  });
  const normalizedProviders = [...dedupedProvidersByName.values()];

  const libraryRaw = parsed.globalCharacterLibrary;
  const globalCharacterLibrary: GlobalLibraryImage[] = Array.isArray(libraryRaw)
    ? libraryRaw.filter(
        (row): row is GlobalLibraryImage =>
          Boolean(
            row &&
              typeof row === "object" &&
              typeof (row as GlobalLibraryImage).id === "string" &&
              typeof (row as GlobalLibraryImage).filePath === "string" &&
              typeof (row as GlobalLibraryImage).createdAt === "string",
          ),
      )
    : [];

  dataStore = {
    settings: {
      ...defaultSettings,
      ...(parsed.settings ?? {}),
      providers: normalizedProviders,
      providerModels: parsed.settings?.providerModels ?? {},
      taskModelMappings: normalizeTaskModelMappings(
        parsed.settings?.taskModelMappings,
      ),
      generationEnabled: {
        ...defaultSettings.generationEnabled,
        ...(parsed.settings?.generationEnabled ?? {}),
      },
      enablePromptCalibration:
        typeof (parsed.settings as AppSettings | undefined)
          ?.enablePromptCalibration === "boolean"
          ? (parsed.settings as AppSettings).enablePromptCalibration
          : defaultSettings.enablePromptCalibration,
      enableEndFramePrompts:
        typeof (parsed.settings as AppSettings | undefined)
          ?.enableEndFramePrompts === "boolean"
          ? (parsed.settings as AppSettings).enableEndFramePrompts
          : defaultSettings.enableEndFramePrompts,
    },
    projects,
    globalCharacterLibrary,
  };
  migrateLegacyProjectData(parsed, projects);
  for (const project of projects) {
    loadProjectData(project.id);
  }
  saveData();

  return dataStore;
}

export function initDb(): void {
  loadOrCreateSecretKey();
  loadData();
}

/** Persist successful provider validation (plaintext key; not stored). */
export function recordProviderValidation(
  provider: ProviderConfig["name"],
  plainApiKey: string,
): void {
  const data = loadData();
  const decoded = decodeSettings(data.settings);
  const nextValidation: NonNullable<AppSettings["providerValidation"]> = {
    ...(decoded.providerValidation ?? {}),
    [provider]: {
      validatedAt: nowIso(),
      apiKeyFingerprint: providerApiKeyFingerprint(plainApiKey),
    },
  };
  data.settings = encodeSettings({
    ...decoded,
    providerValidation: nextValidation,
  });
  saveData();
}

export function getSettings(): AppSettings {
  return decodeSettings(loadData().settings);
}

export function saveSettings(settings: AppSettings): AppSettings {
  const data = loadData();
  const dedupedProvidersByName = new Map<
    ProviderConfig["name"],
    ProviderConfig
  >();
  settings.providers.forEach((provider) => {
    if (!supportedProviderNames.includes(provider.name)) {
      return;
    }
    dedupedProvidersByName.set(provider.name, {
      name: provider.name,
      apiKey: provider.apiKey,
    });
  });
  data.settings = encodeSettings({
    ...settings,
    providers: [...dedupedProvidersByName.values()],
    taskModelMappings: normalizeTaskModelMappings(settings.taskModelMappings),
  });
  saveData();
  return decodeSettings(data.settings);
}

export function createProject(input: ProjectInput): ProjectRecord {
  const data = loadData();
  const projectMode = input.projectMode ?? "pipeline";
  const isSolo = projectMode === "solo";
  const project: ProjectRecord = {
    id: randomUUID(),
    status: isSolo ? "ready" : "processing",
    statusDetail: null,
    archivedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input,
    deliveryProfile: input.deliveryProfile ?? "short_form",
    projectMode,
    logline: null,
    theme: null,
  };

  data.projects.push(project);
  saveData();
  saveProjectData(project.id, defaultProjectData());
  return project;
}

export function updateProjectStatus(
  projectId: string,
  status: ProjectRecord["status"],
  statusDetail?: string | null,
): void {
  const data = loadData();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  project.status = status;
  if (status === "error") {
    project.statusDetail = statusDetail?.trim()
      ? statusDetail.trim()
      : "Unknown generation error";
  } else if (status === "processing" && statusDetail !== undefined) {
    project.statusDetail = statusDetail?.trim() ? statusDetail.trim() : null;
  } else {
    project.statusDetail = null;
  }
  project.updatedAt = nowIso();
  saveData();
}

/** Sub-step message while status stays `processing` (e.g. script vs calibration). */
export function updateProjectProcessingMessage(
  projectId: string,
  message: string | null,
): void {
  const data = loadData();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project || project.status !== "processing") {
    return;
  }
  project.statusDetail = message?.trim() ? message.trim() : null;
  project.updatedAt = nowIso();
  saveData();
}

export function updateProjectScriptMeta(
  projectId: string,
  meta: { logline: string | null; theme: string | null },
): void {
  const data = loadData();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  project.logline = meta.logline;
  project.theme = meta.theme;
  project.updatedAt = nowIso();
  saveData();
}

function getFirstGeneratedImageFilePath(projectId: string): string | null {
  const images = loadProjectData(projectId).assets.filter(
    (asset) => asset.kind === "image",
  );
  if (images.length === 0) {
    return null;
  }
  const sorted = [...images].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  for (const asset of sorted) {
    const p = asset.filePath?.trim();
    if (p && existsSync(p)) {
      return p;
    }
  }
  return null;
}

export function listProjects(options?: {
  includeArchived?: boolean;
}): ProjectWithThumbnail[] {
  const includeArchived = Boolean(options?.includeArchived);
  const items = includeArchived
    ? loadData().projects
    : loadData().projects.filter((project) => !project.archivedAt);
  return [...items]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((project) => ({
      ...project,
      thumbnailFilePath: getFirstGeneratedImageFilePath(project.id),
    }));
}

export function getProject(projectId: string): ProjectRecord {
  const project = loadData().projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
}

export function archiveProject(projectId: string): ProjectRecord {
  const data = loadData();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  if (!project.archivedAt) {
    project.archivedAt = nowIso();
    project.updatedAt = nowIso();
    saveData();
  }
  return normalizeProjectRecord(project);
}

export function unarchiveProject(projectId: string): ProjectRecord {
  const data = loadData();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.archivedAt) {
    project.archivedAt = null;
    project.updatedAt = nowIso();
    saveData();
  }
  return normalizeProjectRecord(project);
}

/** Clears step-1 outputs, characters, scenes, transcripts, and assets for a clean regeneration run. */
export function resetProjectWorkspaceForRegeneration(projectId: string): void {
  getProject(projectId);
  saveProjectData(projectId, defaultProjectData());
}

export function saveStep1Output(
  projectId: string,
  rawResponse: string,
  normalizedJson: string,
): void {
  const projectData = loadProjectData(projectId);
  projectData.step1Outputs.push({
    id: randomUUID(),
    projectId,
    rawResponse,
    normalizedJson,
    version: 1,
    createdAt: nowIso(),
  });
  saveProjectData(projectId, projectData);
}

export function saveCharacters(
  characters: Omit<Character, "id">[],
): Character[] {
  if (characters.length === 0) {
    return [];
  }
  const projectId = characters[0].projectId;
  const projectData = loadProjectData(projectId);
  const records = characters.map((character) => ({
    ...character,
    id: randomUUID(),
  }));
  projectData.characters.push(...records);
  saveProjectData(projectId, projectData);
  return records;
}

export function saveScenes(scenes: Omit<Scene, "id">[]): Scene[] {
  if (scenes.length === 0) {
    return [];
  }
  const projectId = scenes[0].projectId;
  const projectData = loadProjectData(projectId);
  const records = scenes.map((scene) => ({ ...scene, id: randomUUID() }));
  projectData.scenes.push(...records);
  saveProjectData(projectId, projectData);
  return records;
}

export function saveTranscripts(
  transcripts: Omit<TranscriptRow, "id">[],
): TranscriptRow[] {
  if (transcripts.length === 0) {
    return [];
  }
  const projectId = transcripts[0].projectId;
  const projectData = loadProjectData(projectId);
  const records = transcripts.map((transcript) => ({
    ...transcript,
    id: randomUUID(),
  }));
  projectData.transcripts.push(...records);
  saveProjectData(projectId, projectData);
  return records;
}

export function getWorkspace(projectId: string): ProjectWorkspace {
  const project = getProject(projectId);
  const characters = getCharactersByProject(projectId);
  const scenes = getScenesByProject(projectId);
  const transcripts = getTranscriptsByProject(projectId);
  return { project, characters, scenes, transcripts };
}

export function getCharactersByProject(projectId: string): Character[] {
  return loadProjectData(projectId).characters.sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getScenesByProject(projectId: string): Scene[] {
  return loadProjectData(projectId).scenes.sort(
    (a, b) => a.sceneIndex - b.sceneIndex,
  );
}

export function getTranscriptsByProject(projectId: string): TranscriptRow[] {
  return loadProjectData(projectId).transcripts.sort((a, b) =>
    a.scene === b.scene ? a.id.localeCompare(b.id) : a.scene - b.scene,
  );
}

export function updateTranscriptRow(
  transcriptId: string,
  patch: {
    speaker?: string;
    text?: string;
    startSec?: number;
    endSec?: number;
    voiceId?: string;
  },
): TranscriptRow {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const row = projectData.transcripts.find((item) => item.id === transcriptId);
    if (!row) {
      continue;
    }

    if (typeof patch.speaker === "string") {
      row.speaker = patch.speaker.trim();
    }
    if (typeof patch.text === "string") {
      row.text = patch.text.trim();
    }
    if (typeof patch.startSec === "number" && Number.isFinite(patch.startSec)) {
      row.startSec = patch.startSec;
    }
    if (typeof patch.endSec === "number" && Number.isFinite(patch.endSec)) {
      row.endSec = patch.endSec;
    }
    if (typeof patch.voiceId === "string") {
      row.voiceId = patch.voiceId.trim();
    }
    if (row.endSec < row.startSec) {
      row.endSec = row.startSec;
    }

    saveProjectData(project.id, projectData);
    return row;
  }

  throw new Error("Transcript row not found");
}

export function updateTranscriptVoiceBySpeaker(
  projectId: string,
  speaker: string,
  voiceId: string,
): number {
  const projectData = loadProjectData(projectId);
  const normalizedSpeaker = speaker.trim();
  if (!normalizedSpeaker) {
    return 0;
  }
  const normalizedVoiceId = voiceId.trim();
  let affected = 0;
  projectData.transcripts.forEach((row) => {
    if (row.speaker.trim() !== normalizedSpeaker) {
      return;
    }
    row.voiceId = normalizedVoiceId;
    affected += 1;
  });
  if (affected > 0) {
    saveProjectData(projectId, projectData);
  }
  return affected;
}

export function updateCharacterPrompt(
  characterId: string,
  prompt: string,
): Character {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const character = projectData.characters.find(
      (item) => item.id === characterId,
    );
    if (!character) {
      continue;
    }
    character.promptOverride = prompt;
    saveProjectData(project.id, projectData);
    return character;
  }
  throw new Error("Character not found");
}

export function linkCharacterAsset(
  characterId: string,
  assetId: string,
): Character {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const character = projectData.characters.find(
      (item) => item.id === characterId,
    );
    if (!character) {
      continue;
    }
    character.linkedAssetId = assetId;
    saveProjectData(project.id, projectData);
    return character;
  }
  throw new Error("Character not found");
}

export function getCharacter(characterId: string): Character {
  const projects = listProjects();
  for (const project of projects) {
    const character = loadProjectData(project.id).characters.find(
      (item) => item.id === characterId,
    );
    if (character) {
      return character;
    }
  }
  throw new Error("Character not found");
}

export function updateScenePrompts(
  sceneId: string,
  prompts: { textToImage?: string; imageToVideo?: string },
): Scene {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const scene = projectData.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      continue;
    }

    if (typeof prompts.textToImage === "string") {
      scene.promptOverrideTextToImage = prompts.textToImage;
    }
    if (typeof prompts.imageToVideo === "string") {
      scene.promptOverrideImageToVideo = prompts.imageToVideo;
    }

    saveProjectData(project.id, projectData);
    return scene;
  }
  throw new Error("Scene not found");
}

export function saveAsset(
  asset: Omit<AssetRecord, "id" | "createdAt">,
): AssetRecord {
  const projectData = loadProjectData(asset.projectId);
  const record: AssetRecord = {
    ...asset,
    id: randomUUID(),
    createdAt: nowIso(),
  };

  projectData.assets.push(record);
  saveProjectData(asset.projectId, projectData);
  return record;
}

export function getAssetsByProject(projectId: string): AssetRecord[] {
  return loadProjectData(projectId).assets.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function getAsset(assetId: string): AssetRecord {
  const projects = listProjects();
  for (const project of projects) {
    const asset = loadProjectData(project.id).assets.find(
      (item) => item.id === assetId,
    );
    if (asset) {
      return asset;
    }
  }
  throw new Error("Asset not found");
}

export function getProjectAssetsDir(projectId: string): string {
  const directory = join(getProjectDataDir(projectId), "assets");
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** User-uploaded reference images for Solo Mode (image/video generation). */
export function getSoloUploadedReferencesDir(projectId: string): string {
  const directory = join(getProjectAssetsDir(projectId), "uploaded-references");
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function listSoloUploadedReferencePaths(projectId: string): string[] {
  const dir = getSoloUploadedReferencesDir(projectId);
  try {
    return readdirSync(dir)
      .filter((name) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(name))
      .map((name) => join(dir, name))
      .filter((p) => existsSync(p))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function importSoloUploadedReferences(
  projectId: string,
  sourcePaths: string[],
): string[] {
  const destDir = getSoloUploadedReferencesDir(projectId);
  const out: string[] = [];
  for (const src of sourcePaths) {
    if (!src?.trim() || !existsSync(src)) {
      continue;
    }
    const ext = extname(src) || ".png";
    const dest = join(destDir, `ref-${randomUUID()}${ext}`);
    copyFileSync(src, dest);
    out.push(dest);
  }
  return out;
}

export function removeSoloUploadedReference(
  projectId: string,
  absolutePath: string,
): void {
  const root = resolvePath(getSoloUploadedReferencesDir(projectId));
  const target = resolvePath(absolutePath.trim());
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "") {
    throw new Error("Invalid reference path for this project.");
  }
  if (existsSync(target)) {
    unlinkSync(target);
  }
}

/** Ensures the path is under this project's `uploaded-references` directory and exists. */
export function assertSoloUploadedReferenceInProject(
  projectId: string,
  absolutePath: string,
): void {
  const root = resolvePath(getSoloUploadedReferencesDir(projectId));
  const target = resolvePath(absolutePath.trim());
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "") {
    throw new Error("Invalid reference path for this project.");
  }
  if (!existsSync(target)) {
    throw new Error("Reference file not found.");
  }
}

export function ensureDirForFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function resolveGlobalLibraryDir(): string {
  const baseDir = app.isPackaged
    ? join(app.getPath("userData"), "data")
    : join(process.cwd(), "data");
  const directory = join(baseDir, "global-characters");
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function getGlobalLibraryImages(): GlobalLibraryImage[] {
  const rows = loadData().globalCharacterLibrary ?? [];
  return [...rows].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

export function getGlobalLibraryImageById(id: string): GlobalLibraryImage | undefined {
  return (loadData().globalCharacterLibrary ?? []).find((item) => item.id === id);
}

export function upsertGlobalLibraryImage(record: GlobalLibraryImage): void {
  const data = loadData();
  const existing = data.globalCharacterLibrary ?? [];
  data.globalCharacterLibrary = [
    ...existing.filter((item) => item.id !== record.id),
    record,
  ];
  saveData();
}

/** Every generated character image across projects plus library uploads. */
export function listGlobalCharacterGallery(): GlobalCharacterGalleryItem[] {
  const projectItems: GlobalCharacterGalleryItem[] = [];
  for (const project of listProjects({ includeArchived: true })) {
    const rows = getAssetsByProject(project.id);
    for (const asset of rows) {
      if (asset.entityType !== "character" || asset.kind !== "image") {
        continue;
      }
      const characterId = asset.entityId;
      const projectData = loadProjectData(project.id);
      const character = projectData.characters.find(
        (item) => item.id === characterId,
      );
      const characterName = character?.name ?? characterId;
      projectItems.push({
        tileId: `asset:${asset.id}`,
        source: "project",
        assetId: asset.id,
        projectId: project.id,
        projectTitle: project.title,
        characterId,
        characterName,
        filePath: asset.filePath,
        createdAt: asset.createdAt,
        provider: asset.provider,
        model: asset.model,
      });
    }
  }

  const libraryItems: GlobalCharacterGalleryItem[] = getGlobalLibraryImages().map(
    (item) => ({
      tileId: `library:${item.id}`,
      source: "library" as const,
      libraryId: item.id,
      filePath: item.filePath,
      createdAt: item.createdAt,
      originalFileName: item.originalFileName,
    }),
  );

  const merged = [...projectItems, ...libraryItems];
  merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return merged;
}
