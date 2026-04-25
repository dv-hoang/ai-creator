import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  step1Outputs: Step1OutputRecord[];
  characters: Character[];
  scenes: Scene[];
  transcripts: TranscriptRow[];
  assets: AssetRecord[];
}

let dataStore: AppData | null = null;
let dataFilePath = '';

function nowIso(): string {
  return new Date().toISOString();
}

function defaultData(): AppData {
  return {
    settings: defaultSettings,
    projects: [],
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

function saveData(): void {
  if (!dataStore) {
    return;
  }
  writeFileSync(dataFilePath, JSON.stringify(dataStore, null, 2), 'utf8');
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
  const parsed = JSON.parse(raw) as Partial<AppData>;
  dataStore = {
    settings: {
      ...defaultSettings,
      ...(parsed.settings ?? {}),
      providerModels: parsed.settings?.providerModels ?? {}
    },
    projects: parsed.projects ?? [],
    step1Outputs: parsed.step1Outputs ?? [],
    characters: parsed.characters ?? [],
    scenes: parsed.scenes ?? [],
    transcripts: parsed.transcripts ?? [],
    assets: parsed.assets ?? []
  };

  return dataStore;
}

export function initDb(): void {
  loadData();
}

export function getSettings(): AppSettings {
  return loadData().settings;
}

export function saveSettings(settings: AppSettings): AppSettings {
  const data = loadData();
  data.settings = settings;
  saveData();
  return settings;
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
  const data = loadData();
  data.step1Outputs.push({
    id: randomUUID(),
    projectId,
    rawResponse,
    normalizedJson,
    version: 1,
    createdAt: nowIso()
  });
  saveData();
}

export function saveCharacters(characters: Omit<Character, 'id'>[]): Character[] {
  const data = loadData();
  const records = characters.map((character) => ({ ...character, id: randomUUID() }));
  data.characters.push(...records);
  saveData();
  return records;
}

export function saveScenes(scenes: Omit<Scene, 'id'>[]): Scene[] {
  const data = loadData();
  const records = scenes.map((scene) => ({ ...scene, id: randomUUID() }));
  data.scenes.push(...records);
  saveData();
  return records;
}

export function saveTranscripts(transcripts: Omit<TranscriptRow, 'id'>[]): TranscriptRow[] {
  const data = loadData();
  const records = transcripts.map((transcript) => ({ ...transcript, id: randomUUID() }));
  data.transcripts.push(...records);
  saveData();
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
  return loadData()
    .characters.filter((item) => item.projectId === projectId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getScenesByProject(projectId: string): Scene[] {
  return loadData()
    .scenes.filter((item) => item.projectId === projectId)
    .sort((a, b) => a.sceneIndex - b.sceneIndex);
}

export function getTranscriptsByProject(projectId: string): TranscriptRow[] {
  return loadData()
    .transcripts.filter((item) => item.projectId === projectId)
    .sort((a, b) => (a.scene === b.scene ? a.id.localeCompare(b.id) : a.scene - b.scene));
}

export function updateCharacterPrompt(characterId: string, prompt: string): Character {
  const data = loadData();
  const character = data.characters.find((item) => item.id === characterId);
  if (!character) {
    throw new Error('Character not found');
  }

  character.promptOverride = prompt;
  saveData();
  return character;
}

export function linkCharacterAsset(characterId: string, assetId: string): Character {
  const data = loadData();
  const character = data.characters.find((item) => item.id === characterId);
  if (!character) {
    throw new Error('Character not found');
  }

  character.linkedAssetId = assetId;
  saveData();
  return character;
}

export function getCharacter(characterId: string): Character {
  const character = loadData().characters.find((item) => item.id === characterId);
  if (!character) {
    throw new Error('Character not found');
  }
  return character;
}

export function updateScenePrompts(sceneId: string, prompts: { textToImage?: string; imageToVideo?: string }): Scene {
  const data = loadData();
  const scene = data.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new Error('Scene not found');
  }

  if (typeof prompts.textToImage === 'string') {
    scene.promptOverrideTextToImage = prompts.textToImage;
  }
  if (typeof prompts.imageToVideo === 'string') {
    scene.promptOverrideImageToVideo = prompts.imageToVideo;
  }

  saveData();
  return scene;
}

export function saveAsset(asset: Omit<AssetRecord, 'id' | 'createdAt'>): AssetRecord {
  const data = loadData();
  const record: AssetRecord = {
    ...asset,
    id: randomUUID(),
    createdAt: nowIso()
  };

  data.assets.push(record);
  saveData();
  return record;
}

export function getAssetsByProject(projectId: string): AssetRecord[] {
  return loadData()
    .assets.filter((item) => item.projectId === projectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getAsset(assetId: string): AssetRecord {
  const asset = loadData().assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new Error('Asset not found');
  }
  return asset;
}

export function getProjectAssetsDir(projectId: string): string {
  const root = app.isPackaged ? join(app.getPath('userData'), 'assets') : join(process.cwd(), 'data', 'assets');
  const directory = join(root, projectId);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function ensureDirForFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
