export type AppLanguage = 'en' | 'vi';
export type ProviderName = 'openai' | 'gemini' | 'fal' | 'elevenlabs';
export type GenerationTask = 'generateScript' | 'generateImage' | 'generateVideo' | 'textToSpeech';

export interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
}

export interface TaskModelMapping {
  provider: ProviderName;
  model: string;
}

export interface AppSettings {
  language: AppLanguage;
  providers: ProviderConfig[];
  elevenLabsVoiceId: string;
  providerModels: Partial<Record<ProviderName, string[]>>;
  taskModelMappings: Record<GenerationTask, TaskModelMapping>;
  generationEnabled: {
    generateImage: boolean;
    generateVideo: boolean;
  };
}

export interface ProjectInput {
  title: string;
  originalContent: string;
  promptLanguage: 'English' | 'Vietnamese';
  transcriptLanguagePolicy: 'English' | 'Vietnamese';
  aspectRatio: string;
  visualStyle: string;
  artDirectionHint: string;
}

export interface ProjectRecord extends ProjectInput {
  id: string;
  status: 'draft' | 'processing' | 'ready' | 'error';
  statusDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  promptTextToImage: string;
  promptOverride: string | null;
  linkedAssetId: string | null;
}

export interface Scene {
  id: string;
  projectId: string;
  sceneIndex: number;
  title: string;
  summary: string;
  charactersPresent: string[];
  environment: string;
  tone: string;
  keyAction: string;
  cameraAndFraming: string;
  clipDurationSec: number;
  promptTextToImage: string;
  promptImageToVideo: string;
  promptOverrideTextToImage: string | null;
  promptOverrideImageToVideo: string | null;
  requiredCharacterRefs: string[];
}

export interface TranscriptRow {
  id: string;
  projectId: string;
  scene: number;
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  voiceId: string;
}

export type AssetKind = 'image' | 'video' | 'audio' | 'srt' | 'text';
export type AssetEntityType = 'character' | 'scene' | 'video' | 'transcript';

export interface AssetRecord {
  id: string;
  projectId: string;
  entityType: AssetEntityType;
  entityId: string;
  kind: AssetKind;
  filePath: string;
  provider: ProviderName;
  model: string;
  metadataJson: string;
  createdAt: string;
}

export interface Step1Response {
  characters: Array<{ name: string; prompt: string }>;
  transcript: Array<{
    scene: number;
    speaker: string;
    text: string;
    start_sec: number;
    end_sec: number;
  }>;
  scenes: Array<{
    scene: number;
    title: string;
    summary: string;
    characters_present: string[];
    environment: string;
    tone: string;
    key_action: string;
    camera_and_framing: string;
    clip_duration_sec: number;
    image_prompt: string;
    image_to_video_prompt: string;
  }>;
}

export interface ProjectWorkspace {
  project: ProjectRecord;
  characters: Character[];
  scenes: Scene[];
  transcripts: TranscriptRow[];
}

export interface GenerationResult {
  jobId: string;
  asset: AssetRecord;
}

export interface ValidateProviderResult {
  ok: boolean;
  message: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  repo: string;
}

export interface UpdateInstallResult {
  latestVersion: string;
  assetName: string;
  downloadPath: string;
  opened: boolean;
}

export interface ElectronApi {
  settings: {
    get(): Promise<AppSettings>;
    save(settings: AppSettings): Promise<AppSettings>;
    validateProvider(provider: ProviderName, apiKey?: string): Promise<ValidateProviderResult>;
    listModels(provider: ProviderName, apiKey?: string): Promise<string[]>;
    testVoice(settings: AppSettings, sampleText: string): Promise<string>;
    checkForUpdates(): Promise<UpdateCheckResult>;
  };
  projects: {
    list(): Promise<ProjectRecord[]>;
    create(input: ProjectInput): Promise<ProjectWorkspace>;
    getWorkspace(projectId: string): Promise<ProjectWorkspace>;
    retryGenerateScript(projectId: string): Promise<ProjectWorkspace>;
  };
  characters: {
    updatePrompt(characterId: string, prompt: string): Promise<Character>;
    linkAsset(characterId: string, assetId: string): Promise<Character>;
    generateImage(characterId: string): Promise<GenerationResult>;
  };
  scenes: {
    updatePrompts(sceneId: string, prompts: { textToImage?: string; imageToVideo?: string }): Promise<Scene>;
    generateImage(sceneId: string): Promise<GenerationResult>;
    generateVideo(sceneId: string, firstFrameAssetId: string): Promise<GenerationResult>;
  };
  assets: {
    listByProject(projectId: string): Promise<AssetRecord[]>;
    download(projectId: string, assetIds: string[]): Promise<string>;
  };
  transcript: {
    untimedText(projectId: string): Promise<string>;
    exportSrt(projectId: string): Promise<string>;
    generateSpeech(projectId: string): Promise<GenerationResult>;
    generateSpeechAllInOne(projectId: string): Promise<GenerationResult>;
    generateSpeechForScene(sceneId: string): Promise<GenerationResult>;
    updateRow(
      transcriptId: string,
      patch: {
        speaker?: string;
        text?: string;
        startSec?: number;
        endSec?: number;
        voiceId?: string;
      },
    ): Promise<TranscriptRow>;
    updateSpeakerVoice(
      projectId: string,
      speaker: string,
      voiceId: string,
    ): Promise<number>;
  };
  app: {
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<boolean>;
    updateFromLatestRelease(repo?: string): Promise<UpdateInstallResult>;
  };
}
