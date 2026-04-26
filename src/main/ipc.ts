import { app, dialog, ipcMain, shell } from 'electron';
import { copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AppSettings,
  Character,
  GenerationTask,
  ProjectInput,
  ProjectRecord,
  ProviderName,
  Scene,
  Step1Response
} from '@shared/types';
import {
  createProject,
  getAsset,
  getAssetsByProject,
  getCharacter,
  getCharactersByProject,
  getProject,
  getProjectAssetsDir,
  getScenesByProject,
  getSettings,
  getTranscriptsByProject,
  getWorkspace,
  initDb,
  linkCharacterAsset,
  listProjects,
  resetProjectWorkspaceForRegeneration,
  saveAsset,
  saveCharacters,
  saveScenes,
  saveSettings,
  saveStep1Output,
  saveTranscripts,
  updateTranscriptRow,
  updateTranscriptVoiceBySpeaker,
  updateCharacterPrompt,
  updateProjectStatus,
  updateScenePrompts
} from './db';
import {
  generateImage,
  generateSpeech,
  generateStep1,
  generateVideoFromImage,
  listProviderModels,
  synthesizeElevenLabsSpeechPreview,
  validateProvider
} from './providers';
import { buildUntimedTranscript, exportSrt } from './transcript';
import { renderAnimationPrompt } from './template';
import { checkGithubReleaseUpdate } from './update';

const DEFAULT_RELEASE_REPO = 'https://github.com/dv-hoang/ai-creator';

function bind<T>(channel: string, handler: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_, ...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Unknown IPC error', {
        cause: error
      });
    }
  });
}

function projectToScriptInput(project: ProjectRecord): ProjectInput {
  return {
    title: project.title,
    originalContent: project.originalContent,
    promptLanguage: project.promptLanguage,
    transcriptLanguagePolicy: project.transcriptLanguagePolicy,
    aspectRatio: project.aspectRatio,
    visualStyle: project.visualStyle,
    artDirectionHint: project.artDirectionHint
  };
}

function runStep1ScriptPipeline(project: ProjectRecord): void {
  const input = projectToScriptInput(project);
  void (async () => {
    try {
      const prompt = renderAnimationPrompt(input);
      const response = await generateStep1(prompt);
      saveStep1Output(project.id, JSON.stringify(response), JSON.stringify(response));
      const normalized = normalizeStep1(project.id, response);
      saveCharacters(normalized.characters);
      saveScenes(normalized.scenes);
      saveTranscripts(normalized.transcripts);
      updateProjectStatus(project.id, 'ready');
    } catch (error) {
      const errorDetail = error instanceof Error ? error.message : 'Unknown generation error';
      updateProjectStatus(project.id, 'error', errorDetail);
    }
  })();
}

function normalizeStep1(projectId: string, response: Step1Response) {
  const characters = response.characters.map((item) => ({
    projectId,
    name: item.name,
    description: item.prompt,
    promptTextToImage: item.prompt,
    promptOverride: null,
    linkedAssetId: null
  }));

  const scenes = response.scenes.map((item) => ({
    projectId,
    sceneIndex: item.scene,
    title: item.title,
    summary: item.summary,
    charactersPresent: item.characters_present,
    environment: item.environment,
    tone: item.tone,
    keyAction: item.key_action,
    cameraAndFraming: item.camera_and_framing,
    clipDurationSec: item.clip_duration_sec,
    promptTextToImage: item.image_prompt,
    promptImageToVideo: item.image_to_video_prompt,
    promptOverrideTextToImage: null,
    promptOverrideImageToVideo: null,
    requiredCharacterRefs: item.characters_present
  }));

  const transcripts = response.transcript.map((item) => ({
    projectId,
    scene: item.scene,
    speaker: item.speaker,
    text: item.text,
    startSec: item.start_sec,
    endSec: item.end_sec,
    voiceId: ''
  }));

  return { characters, scenes, transcripts };
}

function activeCharacterPrompt(character: Character): string {
  return character.promptOverride ?? character.promptTextToImage;
}

function activeScenePrompts(scene: Scene): { textToImage: string; imageToVideo: string } {
  return {
    textToImage: scene.promptOverrideTextToImage ?? scene.promptTextToImage,
    imageToVideo: scene.promptOverrideImageToVideo ?? scene.promptImageToVideo
  };
}

function resolveSceneCharacterReferencePaths(scene: Scene): string[] {
  const requiredNames = new Set(scene.requiredCharacterRefs);
  if (requiredNames.size === 0) {
    return [];
  }

  const projectAssets = getAssetsByProject(scene.projectId);
  const byCharacterId = new Map<string, Array<(typeof projectAssets)[number]>>();
  for (const asset of projectAssets) {
    if (asset.entityType !== 'character' || asset.kind !== 'image') {
      continue;
    }
    const bucket = byCharacterId.get(asset.entityId) ?? [];
    bucket.push(asset);
    byCharacterId.set(asset.entityId, bucket);
  }

  const references = new Set<string>();
  for (const character of getCharactersByProject(scene.projectId)) {
    if (!requiredNames.has(character.name)) {
      continue;
    }

    if (character.linkedAssetId) {
      try {
        references.add(getAsset(character.linkedAssetId).filePath);
        continue;
      } catch {
        // Fallback to the latest generated character image when linked asset is missing.
      }
    }

    const generatedImages = byCharacterId.get(character.id) ?? [];
    if (generatedImages.length === 0) {
      continue;
    }
    generatedImages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    references.add(generatedImages[0].filePath);
  }

  return [...references];
}

function withProjectContext(
  basePrompt: string,
  options: { aspectRatio: string; visualStyle: string; artDirectionHint: string }
): string {
  return [
    basePrompt,
    '',
    'Project constraints:',
    `- Aspect ratio: ${options.aspectRatio}`,
    `- Visual style: ${options.visualStyle}`,
    `- Art direction hint: ${options.artDirectionHint}`,
    '- Keep output consistent with the above constraints.'
  ].join('\n');
}

function findSceneById(sceneId: string): Scene | null {
  const projects = listProjects();
  for (const project of projects) {
    const found = getScenesByProject(project.id).find((item) => item.id === sceneId);
    if (found) {
      return found;
    }
  }

  return null;
}

function toSpeakerSlug(speaker: string): string {
  return (
    speaker
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'speaker'
  );
}

function withSceneSpeechFileName(filePath: string, sceneIndex: number, speaker: string): string {
  const extension = extname(filePath) || '.mp3';
  const nextName = `scene-${String(sceneIndex).padStart(3, '0')}-${toSpeakerSlug(speaker)}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  return join(dirname(filePath), nextName);
}

const taskSupportedProviders: Record<GenerationTask, ProviderName[]> = {
  generateScript: ['openai', 'gemini'],
  generateImage: ['openai', 'gemini', 'fal'],
  generateVideo: ['openai', 'gemini'],
  textToSpeech: ['elevenlabs']
};

function getCompatibleModelsForTask(task: GenerationTask, provider: ProviderName, models: string[]): string[] {
  if (provider === 'fal' || provider === 'elevenlabs') {
    return models;
  }

  if (provider === 'openai') {
    if (task === 'generateScript') {
      return models.filter((model) => /^(gpt|o\d|chatgpt|text-)/i.test(model.trim()));
    }
    if (task === 'generateImage') {
      return models.filter((model) => /(image|dall|gpt-image)/i.test(model.trim()));
    }
    if (task === 'generateVideo') {
      return models.filter((model) => /(veo|video|sora)/i.test(model.trim()));
    }
    return [];
  }

  if (provider === 'gemini') {
    if (task === 'generateScript') {
      return models.filter((model) => /gemini/i.test(model.trim()));
    }
    if (task === 'generateImage') {
      return models.filter((model) => /(image|gemini)/i.test(model.trim()));
    }
    if (task === 'generateVideo') {
      return models.filter((model) => /(veo|video)/i.test(model.trim()));
    }
    return [];
  }

  return models;
}

function normalizeTaskMappingsForSave(settings: AppSettings): AppSettings['taskModelMappings'] {
  const configuredProviders = settings.providers
    .filter((provider) => provider.apiKey.trim())
    .map((provider) => provider.name);
  const nextMappings = { ...settings.taskModelMappings };

  (Object.keys(taskSupportedProviders) as GenerationTask[]).forEach((task) => {
    const supported = taskSupportedProviders[task];
    const candidates = configuredProviders.filter((provider) => supported.includes(provider));
    const currentProvider = nextMappings[task].provider;
    const provider = candidates.includes(currentProvider) ? currentProvider : (candidates[0] ?? currentProvider);
    const compatibleModels = getCompatibleModelsForTask(task, provider, settings.providerModels[provider] ?? []);
    const model = compatibleModels.includes(nextMappings[task].model)
      ? nextMappings[task].model
      : (compatibleModels[0] ?? '');

    nextMappings[task] = { provider, model };
  });

  return nextMappings;
}

export function registerIpc(): void {
  initDb();

  bind('settings:get', () => getSettings());
  bind('settings:save', async (settings: AppSettings) => {
    const nextSettings = { ...settings, providerModels: { ...settings.providerModels } };
    const providersByName = new Map(settings.providers.map((provider) => [provider.name, provider]));

    for (const [providerName, provider] of providersByName) {
      const key = provider.apiKey?.trim();
      if (!key) {
        nextSettings.providerModels[providerName] = [];
        continue;
      }

      try {
        nextSettings.providerModels[providerName] = await listProviderModels(providerName, key);
      } catch {
        nextSettings.providerModels[providerName] = [];
      }
    }

    nextSettings.taskModelMappings = normalizeTaskMappingsForSave(nextSettings);
    return saveSettings(nextSettings);
  });
  bind('settings:validateProvider', (provider, apiKey?: string) => validateProvider(provider, apiKey));
  bind('settings:listModels', (provider, apiKey?: string) => listProviderModels(provider, apiKey));
  bind('settings:testVoice', async (settings: AppSettings, sampleText: string) => {
    const mapping = settings.taskModelMappings.textToSpeech;
    if (mapping.provider !== 'elevenlabs') {
      throw new Error('Text-to-speech mapping must use ElevenLabs to test voice.');
    }
    const providerRecord = settings.providers.find((provider) => provider.name === 'elevenlabs');
    const apiKey = providerRecord?.apiKey?.trim();
    if (!apiKey) {
      throw new Error('Missing ElevenLabs API key.');
    }
    const configuredVoiceId = settings.elevenLabsVoiceId?.trim() ?? '';
    const voiceId =
      !configuredVoiceId ||
      configuredVoiceId === mapping.model ||
      /^eleven[-_]/i.test(configuredVoiceId)
        ? 'EXAVITQu4vr4xnSDxMaL'
        : configuredVoiceId;
    if (!voiceId) {
      throw new Error('Missing ElevenLabs voice ID.');
    }
    const text = sampleText?.trim() || 'This is a quick voice preview from AI Creator.';
    const audioDataUrl = await synthesizeElevenLabsSpeechPreview({
      model: mapping.model,
      text,
      apiKey,
      voiceId
    });
    return audioDataUrl;
  });
  bind('settings:checkForUpdates', async () => {
    return checkGithubReleaseUpdate(DEFAULT_RELEASE_REPO);
  });
  bind('app:getVersion', () => app.getVersion());
  bind('app:openExternal', async (url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only http/https URLs are allowed');
    }
    await shell.openExternal(url);
    return true;
  });

  bind('projects:list', () => listProjects());
  bind('projects:getWorkspace', (projectId) => getWorkspace(projectId));
  bind('projects:create', async (input: ProjectInput) => {
    const project = createProject(input);
    runStep1ScriptPipeline(project);
    return getWorkspace(project.id);
  });

  bind('projects:retryGenerateScript', async (projectId: string) => {
    const project = getProject(projectId);
    if (project.status !== 'error') {
      throw new Error(
        'Script regeneration is only available when the project is in the error state.'
      );
    }
    resetProjectWorkspaceForRegeneration(projectId);
    updateProjectStatus(projectId, 'processing');
    runStep1ScriptPipeline(getProject(projectId));
    return getWorkspace(projectId);
  });

  bind('characters:updatePrompt', (characterId: string, prompt: string) => updateCharacterPrompt(characterId, prompt));
  bind('characters:linkAsset', (characterId: string, assetId: string) => linkCharacterAsset(characterId, assetId));
  bind('characters:generateImage', async (characterId: string) => {
    const character = getCharacter(characterId);
    const project = getProject(character.projectId);
    const generated = await generateImage({
      projectId: character.projectId,
      entityType: 'character',
      entityId: character.id,
      prompt: withProjectContext(activeCharacterPrompt(character), {
        aspectRatio: project.aspectRatio,
        visualStyle: project.visualStyle,
        artDirectionHint: project.artDirectionHint
      })
    });

    const asset = saveAsset({
      projectId: character.projectId,
      entityType: 'character',
      entityId: character.id,
      kind: 'image',
      filePath: generated.filePath,
      provider: generated.provider,
      model: generated.model,
      metadataJson: generated.metadataJson
    });

    return { jobId: randomUUID(), asset };
  });

  bind('scenes:updatePrompts', (sceneId: string, prompts: { textToImage?: string; imageToVideo?: string }) =>
    updateScenePrompts(sceneId, prompts)
  );
  bind('scenes:generateImage', async (sceneId: string) => {
    const scene = findSceneById(sceneId);
    if (!scene) {
      throw new Error('Scene not found');
    }
    const project = getProject(scene.projectId);
    const characterReferences = resolveSceneCharacterReferencePaths(scene);

    const generated = await generateImage({
      projectId: scene.projectId,
      entityType: 'scene',
      entityId: scene.id,
      prompt: withProjectContext(activeScenePrompts(scene).textToImage, {
        aspectRatio: project.aspectRatio,
        visualStyle: project.visualStyle,
        artDirectionHint: project.artDirectionHint
      }),
      references: characterReferences
    });

    const asset = saveAsset({
      projectId: scene.projectId,
      entityType: 'scene',
      entityId: scene.id,
      kind: 'image',
      filePath: generated.filePath,
      provider: generated.provider,
      model: generated.model,
      metadataJson: generated.metadataJson
    });

    return { jobId: randomUUID(), asset };
  });

  bind('scenes:generateVideo', async (sceneId: string, firstFrameAssetId: string) => {
    const scene = findSceneById(sceneId);
    if (!scene) {
      throw new Error('Scene not found');
    }
    const project = getProject(scene.projectId);

    const generated = await generateVideoFromImage({
      projectId: scene.projectId,
      sceneId: scene.id,
      firstFrameAssetId,
      prompt: withProjectContext(activeScenePrompts(scene).imageToVideo, {
        aspectRatio: project.aspectRatio,
        visualStyle: project.visualStyle,
        artDirectionHint: project.artDirectionHint
      })
    });

    const asset = saveAsset({
      projectId: scene.projectId,
      entityType: 'video',
      entityId: scene.id,
      kind: 'video',
      filePath: generated.filePath,
      provider: generated.provider,
      model: generated.model,
      metadataJson: generated.metadataJson
    });

    return { jobId: randomUUID(), asset };
  });

  bind('assets:listByProject', (projectId: string) => getAssetsByProject(projectId));
  bind('assets:download', (projectId: string, assetIds: string[]) => {
    const project = getProject(projectId);
    return dialog
      .showOpenDialog({
        title: 'Select Download Folder',
        defaultPath: getProjectAssetsDir(projectId),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      })
      .then((selection) => {
        if (selection.canceled || selection.filePaths.length === 0) {
          return '';
        }

        const safeProjectTitle = project.title.replaceAll(/[^a-zA-Z0-9-_]/g, '_') || 'project';
        const downloadDir = join(selection.filePaths[0], `${safeProjectTitle}-assets-${Date.now()}`);
    mkdirSync(downloadDir, { recursive: true });

        const rows = assetIds.map((assetId) => getAsset(assetId));
        rows.forEach((asset) => {
          copyFileSync(asset.filePath, join(downloadDir, basename(asset.filePath)));
        });

        const manifest = join(downloadDir, 'manifest.txt');
        writeFileSync(manifest, rows.map((row) => `${row.kind}: ${row.filePath}`).join('\n'));
        return downloadDir;
      });
  });

  bind('transcript:untimedText', (projectId: string) => buildUntimedTranscript(projectId));
  bind('transcript:exportSrt', async (projectId: string) => {
    const project = getProject(projectId);
    const suggestedName = `${project.title.replaceAll(/[^a-zA-Z0-9-_]/g, '_') || 'transcript'}.srt`;
    const saveResult = await dialog.showSaveDialog({
      title: 'Export SRT',
      defaultPath: join(getProjectAssetsDir(projectId), suggestedName),
      filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return '';
    }

    return exportSrt(projectId, saveResult.filePath);
  });
  bind('transcript:generateSpeech', async (projectId: string) => {
    const rows = getTranscriptsByProject(projectId).filter((row) => row.text.trim());
    if (rows.length === 0) {
      throw new Error('Transcript is empty. Add transcript lines before generating speech.');
    }
    const grouped = new Map<string, { scene: number; speaker: string; lines: string[]; voiceId?: string }>();
    rows.forEach((row) => {
      const scene = row.scene;
      const speaker = row.speaker.trim() || 'Unknown';
      const key = `${scene}::${speaker}`;
      const existing = grouped.get(key) ?? { scene, speaker, lines: [], voiceId: row.voiceId?.trim() };
      existing.lines.push(row.text.trim());
      if (!existing.voiceId && row.voiceId?.trim()) {
        existing.voiceId = row.voiceId.trim();
      }
      grouped.set(key, existing);
    });

    const groups = [...grouped.values()];
    if (groups.length === 0) {
      throw new Error('Transcript is empty. Add transcript lines before generating speech.');
    }

    const generatedAssets = [];
    for (const group of groups) {
      const text = group.lines.join('\n').trim();
      if (!text) continue;
      const generated = await generateSpeech({
        projectId,
        text,
        segments: [{ text, voiceId: group.voiceId }]
      });
      const renamedFilePath = withSceneSpeechFileName(generated.filePath, group.scene, group.speaker);
      renameSync(generated.filePath, renamedFilePath);
      const speakerSlug = toSpeakerSlug(group.speaker);
      const providerMetadata =
        generated.metadataJson && generated.metadataJson.trim()
          ? JSON.parse(generated.metadataJson)
          : {};
      const asset = saveAsset({
        projectId,
        entityType: 'transcript',
        entityId: `${projectId}:scene-${group.scene}:speaker-${speakerSlug}`,
        kind: 'audio',
        filePath: renamedFilePath,
        provider: generated.provider,
        model: generated.model,
        metadataJson: JSON.stringify({
          scene: group.scene,
          speaker: group.speaker,
          providerMetadata
        })
      });
      generatedAssets.push(asset);
    }

    if (generatedAssets.length === 0) {
      throw new Error('Transcript is empty. Add transcript lines before generating speech.');
    }
    return { jobId: randomUUID(), asset: generatedAssets[generatedAssets.length - 1] };
  });
  bind('transcript:generateSpeechAllInOne', async (projectId: string) => {
    const rows = getTranscriptsByProject(projectId).filter((row) => row.text.trim());
    if (rows.length === 0) {
      throw new Error('Transcript is empty. Add transcript lines before generating speech.');
    }
    const text = rows.map((row) => row.text.trim()).join('\n').trim();
    if (!text) {
      throw new Error('Transcript is empty. Add transcript lines before generating speech.');
    }
    const generated = await generateSpeech({
      projectId,
      text
    });
    const asset = saveAsset({
      projectId,
      entityType: 'transcript',
      entityId: projectId,
      kind: 'audio',
      filePath: generated.filePath,
      provider: generated.provider,
      model: generated.model,
      metadataJson: JSON.stringify({
        mode: 'all-in-one',
        providerMetadata:
          generated.metadataJson && generated.metadataJson.trim()
            ? JSON.parse(generated.metadataJson)
            : {}
      })
    });
    return { jobId: randomUUID(), asset };
  });
  bind('transcript:generateSpeechForScene', async (sceneId: string) => {
    const scene = findSceneById(sceneId);
    if (!scene) {
      throw new Error('Scene not found.');
    }
    const rows = getTranscriptsByProject(scene.projectId).filter(
      (row) => row.scene === scene.sceneIndex && row.text.trim()
    );
    if (rows.length === 0) {
      throw new Error('Scene transcript is empty. Add transcript lines before generating speech.');
    }

    const grouped = new Map<string, { speaker: string; lines: string[]; voiceId?: string }>();
    rows.forEach((row) => {
      const speaker = row.speaker.trim() || 'Unknown';
      const existing = grouped.get(speaker) ?? { speaker, lines: [], voiceId: row.voiceId?.trim() };
      existing.lines.push(row.text.trim());
      if (!existing.voiceId && row.voiceId?.trim()) {
        existing.voiceId = row.voiceId.trim();
      }
      grouped.set(speaker, existing);
    });

    const generatedAssets = [];
    for (const group of grouped.values()) {
      const text = group.lines.join('\n').trim();
      if (!text) continue;
      const generated = await generateSpeech({
        projectId: scene.projectId,
        text,
        segments: [{ text, voiceId: group.voiceId }]
      });
      const renamedFilePath = withSceneSpeechFileName(generated.filePath, scene.sceneIndex, group.speaker);
      renameSync(generated.filePath, renamedFilePath);
      const providerMetadata =
        generated.metadataJson && generated.metadataJson.trim()
          ? JSON.parse(generated.metadataJson)
          : {};
      const asset = saveAsset({
        projectId: scene.projectId,
        entityType: 'scene',
        entityId: scene.id,
        kind: 'audio',
        filePath: renamedFilePath,
        provider: generated.provider,
        model: generated.model,
        metadataJson: JSON.stringify({
          scene: scene.sceneIndex,
          speaker: group.speaker,
          providerMetadata
        })
      });
      generatedAssets.push(asset);
    }

    if (generatedAssets.length === 0) {
      throw new Error('Scene transcript is empty. Add transcript lines before generating speech.');
    }
    return { jobId: randomUUID(), asset: generatedAssets[generatedAssets.length - 1] };
  });
  bind(
    'transcript:updateRow',
    (
      transcriptId: string,
      patch: { speaker?: string; text?: string; startSec?: number; endSec?: number; voiceId?: string }
    ) => updateTranscriptRow(transcriptId, patch)
  );
  bind('transcript:updateSpeakerVoice', (projectId: string, speaker: string, voiceId: string) =>
    updateTranscriptVoiceBySpeaker(projectId, speaker, voiceId)
  );
}
