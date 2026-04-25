import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  AppSettings,
  AssetRecord,
  Character,
  ProjectInput,
  ProjectRecord,
  ProjectWorkspace,
  Scene,
  TranscriptRow
} from '@shared/types';

const defaultSettings: AppSettings = {
  language: 'en',
  providerKeys: {},
  providerModels: {},
  taskModelMappings: {
    generateScript: { provider: 'openai', model: 'gpt-5-mini' },
    generateImage: { provider: 'gemini', model: 'banana-2' },
    generateVideo: { provider: 'openai', model: 'veo-3' }
  }
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
}

interface ProjectData {
  step1Outputs: Step1OutputRecord[];
  characters: Character[];
  scenes: Scene[];
  transcripts: TranscriptRow[];
  assets: AssetRecord[];
}

let dataStore: AppData | null = null;
let dataFilePath = '';
let secretFilePath = '';
let secretKey: Buffer | null = null;
const projectStore = new Map<string, ProjectData>();

function nowIso(): string {
  return new Date().toISOString();
}

function defaultData(): AppData {
  return {
    settings: defaultSettings,
    projects: []
  };
}

function defaultProjectData(): ProjectData {
  return {
    step1Outputs: [],
    characters: [],
    scenes: [],
    transcripts: [],
    assets: []
  };
}

function resolveDataFilePath(): string {
  const baseDir = app.isPackaged ? join(app.getPath('userData'), 'data') : join(process.cwd(), 'data');
  mkdirSync(baseDir, { recursive: true });
  return join(baseDir, 'ai-creator.json');
}

function resolveProjectsRootDir(): string {
  const baseDir = app.isPackaged ? join(app.getPath('userData'), 'data') : join(process.cwd(), 'data');
  const projectsDir = join(baseDir, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  return projectsDir;
}

function getProjectDataDir(projectId: string): string {
  const directory = join(resolveProjectsRootDir(), projectId);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function getProjectDataFilePath(projectId: string): string {
  return join(getProjectDataDir(projectId), 'project-data.json');
}

function resolveSecretFilePath(): string {
  const baseDir = app.isPackaged ? join(app.getPath('userData'), 'data') : join(process.cwd(), 'data');
  mkdirSync(baseDir, { recursive: true });
  return join(baseDir, 'secret.key');
}

function loadOrCreateSecretKey(): Buffer {
  if (secretKey) {
    return secretKey;
  }

  if (!secretFilePath) {
    secretFilePath = resolveSecretFilePath();
  }

  if (!existsSync(secretFilePath)) {
    const generated = randomBytes(32).toString('base64');
    writeFileSync(secretFilePath, generated, 'utf8');
    secretKey = Buffer.from(generated, 'base64');
    return secretKey;
  }

  const raw = readFileSync(secretFilePath, 'utf8').trim();
  const parsed = Buffer.from(raw, 'base64');
  if (parsed.length !== 32) {
    const generated = randomBytes(32).toString('base64');
    writeFileSync(secretFilePath, generated, 'utf8');
    secretKey = Buffer.from(generated, 'base64');
    return secretKey;
  }

  secretKey = parsed;
  return secretKey;
}

function encryptSecret(plainText: string): string {
  if (!plainText) {
    return '';
  }
  const key = loadOrCreateSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

function decryptSecret(encoded: string): string {
  if (!encoded) {
    return '';
  }
  if (!encoded.startsWith('enc:v1:')) {
    return encoded;
  }
  const payload = Buffer.from(encoded.slice('enc:v1:'.length), 'base64');
  if (payload.length < 12 + 16) {
    return '';
  }
  const key = loadOrCreateSecretKey();
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const data = payload.subarray(28);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function decodeSettings(settings: AppSettings): AppSettings {
  const decodedProviderKeys = Object.fromEntries(
    Object.entries(settings.providerKeys).map(([provider, key]) => [provider, decryptSecret(key ?? '')])
  ) as AppSettings['providerKeys'];

  return {
    ...settings,
    providerKeys: decodedProviderKeys
  };
}

function encodeSettings(settings: AppSettings): AppSettings {
  const encodedProviderKeys = Object.fromEntries(
    Object.entries(settings.providerKeys).map(([provider, key]) => [provider, encryptSecret((key ?? '').trim())])
  ) as AppSettings['providerKeys'];

  return {
    ...settings,
    providerKeys: encodedProviderKeys
  };
}

function saveData(): void {
  if (!dataStore) {
    return;
  }
  writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2), 'utf8');
}

function saveProjectData(projectId: string, projectData: ProjectData): void {
  const filePath = getProjectDataFilePath(projectId);
  writeFileSync(filePath, JSON.stringify(projectData, null, 2), 'utf8');
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

  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ProjectData>;
  const normalized: ProjectData = {
    step1Outputs: parsed.step1Outputs ?? [],
    characters: parsed.characters ?? [],
    scenes: parsed.scenes ?? [],
    transcripts: parsed.transcripts ?? [],
    assets: parsed.assets ?? []
  };
  projectStore.set(projectId, normalized);
  return normalized;
}

function migrateLegacyProjectData(parsed: any, projects: ProjectRecord[]): void {
  const legacyStep1Outputs = Array.isArray(parsed.step1Outputs) ? parsed.step1Outputs as Step1OutputRecord[] : [];
  const legacyCharacters = Array.isArray(parsed.characters) ? parsed.characters as Character[] : [];
  const legacyScenes = Array.isArray(parsed.scenes) ? parsed.scenes as Scene[] : [];
  const legacyTranscripts = Array.isArray(parsed.transcripts) ? parsed.transcripts as TranscriptRow[] : [];
  const legacyAssets = Array.isArray(parsed.assets) ? parsed.assets as AssetRecord[] : [];

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
      step1Outputs: [...projectData.step1Outputs, ...legacyStep1Outputs.filter((item) => item.projectId === project.id)],
      characters: [...projectData.characters, ...legacyCharacters.filter((item) => item.projectId === project.id)],
      scenes: [...projectData.scenes, ...legacyScenes.filter((item) => item.projectId === project.id)],
      transcripts: [...projectData.transcripts, ...legacyTranscripts.filter((item) => item.projectId === project.id)],
      assets: [...projectData.assets, ...legacyAssets.filter((item) => item.projectId === project.id)]
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

  const raw = readFileSync(dataFilePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<AppData> & Record<string, unknown>;
  const projects = parsed.projects ?? [];
  dataStore = {
    settings: {
      ...defaultSettings,
      ...(parsed.settings ?? {}),
      providerModels: parsed.settings?.providerModels ?? {}
    },
    projects
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

export function getSettings(): AppSettings {
  return decodeSettings(loadData().settings);
}

export function saveSettings(settings: AppSettings): AppSettings {
  const data = loadData();
  data.settings = encodeSettings(settings);
  saveData();
  return decodeSettings(data.settings);
}

export function createProject(input: ProjectInput): ProjectRecord {
  const data = loadData();
  const project: ProjectRecord = {
    id: randomUUID(),
    status: 'processing',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input
  };

  data.projects.push(project);
  saveData();
  saveProjectData(project.id, defaultProjectData());
  return project;
}

export function updateProjectStatus(projectId: string, status: ProjectRecord['status']): void {
  const data = loadData();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  project.status = status;
  project.updatedAt = nowIso();
  saveData();
}

export function listProjects(): ProjectRecord[] {
  return [...loadData().projects].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getProject(projectId: string): ProjectRecord {
  const project = loadData().projects.find((item) => item.id === projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  return project;
}

export function saveStep1Output(projectId: string, rawResponse: string, normalizedJson: string): void {
  const projectData = loadProjectData(projectId);
  projectData.step1Outputs.push({
    id: randomUUID(),
    projectId,
    rawResponse,
    normalizedJson,
    version: 1,
    createdAt: nowIso()
  });
  saveProjectData(projectId, projectData);
}

export function saveCharacters(characters: Omit<Character, 'id'>[]): Character[] {
  if (characters.length === 0) {
    return [];
  }
  const projectId = characters[0].projectId;
  const projectData = loadProjectData(projectId);
  const records = characters.map((character) => ({ ...character, id: randomUUID() }));
  projectData.characters.push(...records);
  saveProjectData(projectId, projectData);
  return records;
}

export function saveScenes(scenes: Omit<Scene, 'id'>[]): Scene[] {
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

export function saveTranscripts(transcripts: Omit<TranscriptRow, 'id'>[]): TranscriptRow[] {
  if (transcripts.length === 0) {
    return [];
  }
  const projectId = transcripts[0].projectId;
  const projectData = loadProjectData(projectId);
  const records = transcripts.map((transcript) => ({ ...transcript, id: randomUUID() }));
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
  return loadProjectData(projectId)
    .characters
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getScenesByProject(projectId: string): Scene[] {
  return loadProjectData(projectId)
    .scenes
    .sort((a, b) => a.sceneIndex - b.sceneIndex);
}

export function getTranscriptsByProject(projectId: string): TranscriptRow[] {
  return loadProjectData(projectId)
    .transcripts
    .sort((a, b) => (a.scene === b.scene ? a.id.localeCompare(b.id) : a.scene - b.scene));
}

export function updateCharacterPrompt(characterId: string, prompt: string): Character {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const character = projectData.characters.find((item) => item.id === characterId);
    if (!character) {
      continue;
    }
    character.promptOverride = prompt;
    saveProjectData(project.id, projectData);
    return character;
  }
  throw new Error('Character not found');
}

export function linkCharacterAsset(characterId: string, assetId: string): Character {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const character = projectData.characters.find((item) => item.id === characterId);
    if (!character) {
      continue;
    }
    character.linkedAssetId = assetId;
    saveProjectData(project.id, projectData);
    return character;
  }
  throw new Error('Character not found');
}

export function getCharacter(characterId: string): Character {
  const projects = listProjects();
  for (const project of projects) {
    const character = loadProjectData(project.id).characters.find((item) => item.id === characterId);
    if (character) {
      return character;
    }
  }
  throw new Error('Character not found');
}

export function updateScenePrompts(sceneId: string, prompts: { textToImage?: string; imageToVideo?: string }): Scene {
  const projects = listProjects();
  for (const project of projects) {
    const projectData = loadProjectData(project.id);
    const scene = projectData.scenes.find((item) => item.id === sceneId);
    if (!scene) {
      continue;
    }

    if (typeof prompts.textToImage === 'string') {
      scene.promptOverrideTextToImage = prompts.textToImage;
    }
    if (typeof prompts.imageToVideo === 'string') {
      scene.promptOverrideImageToVideo = prompts.imageToVideo;
    }

    saveProjectData(project.id, projectData);
    return scene;
  }
  throw new Error('Scene not found');
}

export function saveAsset(asset: Omit<AssetRecord, 'id' | 'createdAt'>): AssetRecord {
  const projectData = loadProjectData(asset.projectId);
  const record: AssetRecord = {
    ...asset,
    id: randomUUID(),
    createdAt: nowIso()
  };

  projectData.assets.push(record);
  saveProjectData(asset.projectId, projectData);
  return record;
}

export function getAssetsByProject(projectId: string): AssetRecord[] {
  return loadProjectData(projectId)
    .assets
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getAsset(assetId: string): AssetRecord {
  const projects = listProjects();
  for (const project of projects) {
    const asset = loadProjectData(project.id).assets.find((item) => item.id === assetId);
    if (asset) {
      return asset;
    }
  }
  throw new Error('Asset not found');
}

export function getProjectAssetsDir(projectId: string): string {
  const directory = join(getProjectDataDir(projectId), 'assets');
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function ensureDirForFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
