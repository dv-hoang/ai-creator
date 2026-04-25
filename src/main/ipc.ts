import { ipcMain } from 'electron';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Character, ProjectInput, Scene, Step1Response } from '@shared/types';
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
  getWorkspace,
  initDb,
  linkCharacterAsset,
  listProjects,
  saveAsset,
  saveCharacters,
  saveScenes,
  saveSettings,
  saveStep1Output,
  saveTranscripts,
  updateCharacterPrompt,
  updateProjectStatus,
  updateScenePrompts
} from './db';
import { generateImage, generateStep1, generateVideoFromImage, listProviderModels, validateProvider } from './providers';
import { buildUntimedTranscript, exportSrt } from './transcript';
import { renderAnimationPrompt } from './template';

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
    endSec: item.end_sec
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

export function registerIpc(): void {
  initDb();

  bind('settings:get', () => getSettings());
  bind('settings:save', async (settings) => {
    const nextSettings = { ...settings, providerModels: { ...settings.providerModels } };
    const providers = ['openai', 'gemini'] as const;

    for (const provider of providers) {
      const key = nextSettings.providerKeys[provider]?.trim();
      if (!key) {
        nextSettings.providerModels[provider] = [];
        continue;
      }

      try {
        nextSettings.providerModels[provider] = await listProviderModels(provider, key);
      } catch {
        nextSettings.providerModels[provider] = [];
      }
    }

    return saveSettings(nextSettings);
  });
  bind('settings:validateProvider', (provider, apiKey?: string) => validateProvider(provider, apiKey));
  bind('settings:listModels', (provider, apiKey?: string) => listProviderModels(provider, apiKey));

  bind('projects:list', () => listProjects());
  bind('projects:getWorkspace', (projectId) => getWorkspace(projectId));
  bind('projects:create', async (input: ProjectInput) => {
    const project = createProject(input);

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
      updateProjectStatus(project.id, 'error');
      throw error;
    }

    return getWorkspace(project.id);
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

    const characterReferences = getCharactersByProject(scene.projectId)
      .filter((character) => scene.requiredCharacterRefs.includes(character.name) && character.linkedAssetId)
      .map((character) => character.linkedAssetId as string)
      .map((assetId) => getAsset(assetId).filePath);

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
    const projectDir = getProjectAssetsDir(projectId);
    const downloadDir = join(projectDir, 'downloads', String(Date.now()));
    mkdirSync(downloadDir, { recursive: true });

    const rows = assetIds.map((assetId) => getAsset(assetId));
    rows.forEach((asset) => {
      copyFileSync(asset.filePath, join(downloadDir, basename(asset.filePath)));
    });

    const manifest = join(downloadDir, 'manifest.txt');
    writeFileSync(manifest, rows.map((row) => `${row.kind}: ${row.filePath}`).join('\n'));
    return downloadDir;
  });

  bind('transcript:untimedText', (projectId: string) => buildUntimedTranscript(projectId));
  bind('transcript:exportSrt', (projectId: string) => exportSrt(projectId));
}
