export type AppLanguage = 'en' | 'vi';
export type ProviderName = 'openai' | 'gemini' | 'fal' | 'elevenlabs';
export type GenerationTask = 'generateScript' | 'generateImage' | 'generateVideo' | 'textToSpeech';

/** Step-1 script style: short-form viral vs professional animation pacing. */
export type DeliveryProfile = 'short_form' | 'animation_studio';

export interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
}

/** Persisted result of a successful provider key check (fingerprint matches current key). */
export interface ProviderValidationEntry {
  validatedAt: string;
  apiKeyFingerprint: string;
}

export interface TaskModelMapping {
  provider: ProviderName;
  model: string;
}

/** Fal catalog kind for `endpoint_id` rows from `api.fal.ai/v1/models`; used to split image vs video tasks. */
export type FalModelCategories = Partial<Record<string, "image" | "video">>;

export interface AppSettings {
  language: AppLanguage;
  providers: ProviderConfig[];
  elevenLabsVoiceId: string;
  providerModels: Partial<Record<ProviderName, string[]>>;
  /** Populated when Flux (fal) models are listed; keys are fal `endpoint_id` strings. */
  falModelCategories?: FalModelCategories;
  taskModelMappings: Record<GenerationTask, TaskModelMapping>;
  generationEnabled: {
    generateImage: boolean;
    generateVideo: boolean;
  };
  /** Second LLM pass after Step 1 to tighten continuity and prompts. */
  enablePromptCalibration: boolean;
  /** Ask the model for optional end-frame fields (stored only until video pipeline supports them). */
  enableEndFramePrompts: boolean;
  /** Last successful validate per provider; fingerprint must match current API key. */
  providerValidation?: Partial<Record<ProviderName, ProviderValidationEntry>>;
}

export interface ProjectInput {
  title: string;
  originalContent: string;
  promptLanguage: 'English' | 'Vietnamese';
  transcriptLanguagePolicy: 'English' | 'Vietnamese';
  aspectRatio: string;
  visualStyle: string;
  artDirectionHint: string;
  deliveryProfile: DeliveryProfile;
}

export interface ProjectRecord extends ProjectInput {
  id: string;
  status: 'draft' | 'processing' | 'ready' | 'error';
  statusDetail: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Filled after successful Step 1 when the model returns them. */
  logline: string | null;
  theme: string | null;
}

/** `projects:list` attaches the earliest generated image path (never persisted on disk). */
export type ProjectWithThumbnail = ProjectRecord & {
  thumbnailFilePath: string | null;
};

export interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  promptTextToImage: string;
  promptOverride: string | null;
  linkedAssetId: string | null;
  /** Identity lock / do-not-change hints from Step 1 (optional). */
  negativeConsistency: string | null;
}

export type ShotSize = 'WS' | 'MS' | 'CU' | 'ECU' | 'FS';

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
  shotSize: ShotSize | null;
  ambientSound: string | null;
  soundEffect: string | null;
  dialogueCue: string | null;
  endFramePrompt: string | null;
  needsEndFrame: boolean | null;
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
  logline?: string;
  theme?: string;
  characters: Array<{ name: string; prompt: string; negative_consistency?: string }>;
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
    shot_size?: ShotSize;
    ambient_sound?: string;
    sound_effect?: string;
    dialogue_cue?: string;
    end_frame_prompt?: string;
    needs_end_frame?: boolean;
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

/** App-wide uploads shown in Characters gallery (distinct from project assets). */
export interface GlobalLibraryImage {
  id: string;
  filePath: string;
  originalFileName: string;
  createdAt: string;
}

export type GlobalCharacterGalleryItem =
  | {
      tileId: string;
      source: 'project';
      assetId: string;
      projectId: string;
      projectTitle: string;
      characterId: string;
      characterName: string;
      filePath: string;
      createdAt: string;
      provider: ProviderName;
      model: string;
    }
  | {
      tileId: string;
      source: 'library';
      libraryId: string;
      filePath: string;
      createdAt: string;
      originalFileName: string;
    };

export type GlobalCharacterApplySource =
  | { source: 'asset'; assetId: string }
  | { source: 'library'; libraryId: string };

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

/** `settings:listModels` — fal includes `falModelCategories` when the catalog loads. */
export interface ListProviderModelsResult {
  models: string[];
  falModelCategories?: FalModelCategories;
}

export interface ElectronApi {
  settings: {
    get(): Promise<AppSettings>;
    save(settings: AppSettings): Promise<AppSettings>;
    validateProvider(provider: ProviderName, apiKey?: string): Promise<ValidateProviderResult>;
    listModels(
      provider: ProviderName,
      apiKey?: string,
    ): Promise<ListProviderModelsResult>;
    testVoice(settings: AppSettings, sampleText: string): Promise<string>;
    checkForUpdates(): Promise<UpdateCheckResult>;
  };
  projects: {
    list(options?: { includeArchived?: boolean }): Promise<ProjectWithThumbnail[]>;
    create(input: ProjectInput): Promise<ProjectWorkspace>;
    getWorkspace(projectId: string): Promise<ProjectWorkspace>;
    retryGenerateScript(projectId: string): Promise<ProjectWorkspace>;
    archive(projectId: string): Promise<ProjectRecord>;
    unarchive(projectId: string): Promise<ProjectRecord>;
  };
  globalCharacters: {
    listGallery(): Promise<GlobalCharacterGalleryItem[]>;
    uploadLibraryImage(): Promise<GlobalLibraryImage | null>;
    applyMapping(characterId: string, payload: GlobalCharacterApplySource): Promise<GenerationResult>;
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
    generateSpeech(
      projectId: string,
      options?: { speed?: number },
    ): Promise<GenerationResult>;
    generateSpeechAllInOne(
      projectId: string,
      options?: { speed?: number },
    ): Promise<GenerationResult>;
    generateSpeechForScene(
      sceneId: string,
      options?: { speed?: number },
    ): Promise<GenerationResult>;
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
