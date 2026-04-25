import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { AppSettings, GenerationTask, ProviderName, Step1Response, ValidateProviderResult } from '@shared/types';
import { getAsset, getProjectAssetsDir, getSettings } from './db';
import { step1Schema } from './schemas';
import { stripJsonFence } from './template';

type SharpLike = (input: string) => {
  rotate: () => ReturnType<SharpLike>;
  resize: (options: { width: number; withoutEnlargement: boolean }) => ReturnType<SharpLike>;
  webp: (options: { quality: number; effort: number }) => ReturnType<SharpLike>;
  toFile: (path: string) => Promise<unknown>;
};

let cachedSharp: SharpLike | null = null;
let sharpLoadError: string | null = null;

async function loadSharp(): Promise<SharpLike | null> {
  if (cachedSharp) {
    return cachedSharp;
  }
  if (sharpLoadError) {
    return null;
  }

  try {
    const mod = await import('sharp');
    const candidate = (mod.default ?? mod) as unknown;
    if (typeof candidate !== 'function') {
      sharpLoadError = 'sharp export is not callable';
      return null;
    }
    cachedSharp = candidate as SharpLike;
    return cachedSharp;
  } catch (error) {
    sharpLoadError = error instanceof Error ? error.message : 'failed to load sharp';
    return null;
  }
}

function getKey(provider: ProviderName, settings: AppSettings): string {
  const key = settings.providerKeys[provider];
  if (!key) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  return key;
}

function resolveTask(task: GenerationTask, settings: AppSettings): { provider: ProviderName; model: string } {
  return settings.taskModelMappings[task];
}

async function ensureOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${await res.text()}`);
  }
}

async function callOpenAiChat(model: string, prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    })
  });

  await ensureOk(res, 'OpenAI chat completion');

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? '';
}

async function callGeminiText(model: string, prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    })
  });

  await ensureOk(res, 'Gemini generateContent');

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
}

function pickImageExtension(contentType: string | null, fallback = 'png'): string {
  if (!contentType) {
    return fallback;
  }
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('mp4')) return 'mp4';
  return fallback;
}

function mimeTypeFromImagePath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/png';
}

async function downloadToFile(url: string, outputPathWithoutExt: string): Promise<string> {
  const res = await fetch(url);
  await ensureOk(res, 'Asset download');
  const extension = pickImageExtension(res.headers.get('content-type'));
  const bytes = Buffer.from(await res.arrayBuffer());
  const filePath = `${outputPathWithoutExt}.${extension}`;
  writeFileSync(filePath, bytes);
  return filePath;
}

async function archiveAndCompressGeneratedImage(
  filePath: string,
  projectAssetsDir: string
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const sharp = await loadSharp();
  if (!sharp) {
    return {
      filePath,
      metadata: {
        compressed: false,
        reason: 'sharp_unavailable',
        detail: sharpLoadError ?? 'sharp module could not be loaded'
      }
    };
  }

  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    return { filePath, metadata: { compressed: false, reason: 'unsupported_format' } };
  }

  const originDir = join(projectAssetsDir, 'origin');
  const compressedDir = join(projectAssetsDir, 'compressed');
  mkdirSync(originDir, { recursive: true });
  mkdirSync(compressedDir, { recursive: true });

  const originalBaseName = basename(filePath);
  const baseNameWithoutExt = basename(filePath, extname(filePath));
  const archivedOriginalPath = join(originDir, originalBaseName);
  const compressedPath = join(compressedDir, `${baseNameWithoutExt}.webp`);
  const beforeBytes = statSync(filePath).size;
  const tempPath = `${compressedPath}.tmp`;

  await sharp(filePath)
    .rotate()
    .resize({ width: 1536, withoutEnlargement: true })
    .webp({ quality: 80, effort: 6 })
    .toFile(tempPath);

  renameSync(filePath, archivedOriginalPath);
  renameSync(tempPath, compressedPath);

  const afterBytes = statSync(compressedPath).size;
  return {
    filePath: compressedPath,
    metadata: {
      compressed: true,
      sourceFormat: extension,
      targetFormat: 'webp',
      beforeBytes,
      afterBytes,
      reductionPercent: beforeBytes > 0 ? Number((((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2)) : 0,
      archivedOriginalPath,
      compressedPath
    }
  };
}

async function openAiGenerateImage(
  model: string,
  prompt: string,
  apiKey: string,
  outputPathWithoutExt: string
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json'
    })
  });
  await ensureOk(res, 'OpenAI image generation');

  const data = (await res.json()) as {
    created?: number;
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const first = data.data?.[0];
  if (!first) {
    throw new Error('OpenAI image generation returned no image data');
  }

  if (first.b64_json) {
    const bytes = Buffer.from(first.b64_json, 'base64');
    const filePath = `${outputPathWithoutExt}.png`;
    writeFileSync(filePath, bytes);
    return { filePath, metadata: { created: data.created, output: 'b64_json' } };
  }

  if (first.url) {
    const filePath = await downloadToFile(first.url, outputPathWithoutExt);
    return { filePath, metadata: { created: data.created, output: 'url' } };
  }

  throw new Error('OpenAI image generation response missing b64_json/url');
}

async function geminiGenerateImage(
  model: string,
  prompt: string,
  apiKey: string,
  outputPathWithoutExt: string,
  referenceImagePaths: string[] = []
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestParts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const imagePath of referenceImagePaths) {
    const imageBytes = readFileSync(imagePath);
    requestParts.push({
      inlineData: {
        mimeType: mimeTypeFromImagePath(imagePath),
        data: imageBytes.toString('base64')
      }
    });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: requestParts }]
    })
  });
  await ensureOk(res, 'Gemini image generation');

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inline_data?: { mime_type?: string; data?: string };
          inlineData?: { mimeType?: string; data?: string };
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const inline =
    parts.find((p) => p.inline_data?.data)?.inline_data ?? parts.find((p) => p.inlineData?.data)?.inlineData;

  if (!inline?.data) {
    throw new Error('Gemini image generation did not return inline image bytes');
  }

  let inlineMimeType: string | undefined;
  if ('mime_type' in inline) {
    inlineMimeType = inline.mime_type;
  } else if ('mimeType' in inline) {
    inlineMimeType = inline.mimeType;
  }
  const extension = pickImageExtension(inlineMimeType ?? 'image/png');
  const filePath = `${outputPathWithoutExt}.${extension}`;
  writeFileSync(filePath, Buffer.from(inline.data, 'base64'));
  return { filePath, metadata: { mimeType: inlineMimeType } };
}

async function openAiGenerateVideoFromImage(
  model: string,
  prompt: string,
  firstFrameAssetPath: string,
  apiKey: string,
  outputPathWithoutExt: string
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const firstFrameBytes = readFileSync(firstFrameAssetPath);
  const imageBase64 = firstFrameBytes.toString('base64');

  const createRes = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      image: imageBase64
    })
  });
  await ensureOk(createRes, 'OpenAI video create');
  const created = (await createRes.json()) as { id?: string; status?: string };
  if (!created.id) {
    throw new Error('OpenAI video create did not return an id');
  }

  const deadlineMs = Date.now() + 5 * 60 * 1000;
  let status = created.status ?? 'queued';
  while (Date.now() < deadlineMs && (status === 'queued' || status === 'in_progress')) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const retrieveRes = await fetch(`https://api.openai.com/v1/videos/${created.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    await ensureOk(retrieveRes, 'OpenAI video status');
    const retrieved = (await retrieveRes.json()) as { status?: string; progress?: number };
    status = retrieved.status ?? 'failed';
  }

  if (status !== 'completed') {
    throw new Error(`OpenAI video generation did not complete (status=${status})`);
  }

  const contentRes = await fetch(`https://api.openai.com/v1/videos/${created.id}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  await ensureOk(contentRes, 'OpenAI video download');
  const bytes = Buffer.from(await contentRes.arrayBuffer());
  const filePath = `${outputPathWithoutExt}.mp4`;
  writeFileSync(filePath, bytes);

  return { filePath, metadata: { videoId: created.id } };
}

async function geminiGenerateVideoFromImage(
  model: string,
  prompt: string,
  firstFrameAssetPath: string,
  apiKey: string,
  outputPathWithoutExt: string
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const firstFrameBytes = readFileSync(firstFrameAssetPath);
  const firstFrameExtension = firstFrameAssetPath.split('.').pop()?.toLowerCase() ?? 'png';
  const firstFrameMime = firstFrameExtension === 'jpg' ? 'image/jpeg' : `image/${firstFrameExtension}`;

  const createRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateVideos?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image: {
        inlineData: {
          mimeType: firstFrameMime,
          data: firstFrameBytes.toString('base64')
        }
      }
    })
  });
  await ensureOk(createRes, 'Gemini video create');
  const created = (await createRes.json()) as { name?: string; done?: boolean };
  if (!created.name) {
    throw new Error('Gemini video create did not return operation name');
  }

  const operationName = created.name;
  const deadlineMs = Date.now() + 5 * 60 * 1000;
  let done = created.done ?? false;
  let responsePayload: Record<string, unknown> | null = null;

  while (!done && Date.now() < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`);
    await ensureOk(statusRes, 'Gemini video status');
    const statusData = (await statusRes.json()) as {
      done?: boolean;
      response?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (statusData.error?.message) {
      throw new Error(`Gemini video operation failed: ${statusData.error.message}`);
    }
    done = statusData.done ?? false;
    responsePayload = statusData.response ?? null;
  }

  if (!done || !responsePayload) {
    throw new Error('Gemini video generation timed out');
  }

  const generatedVideos = (responsePayload['generatedVideos'] as Array<Record<string, unknown>> | undefined) ?? [];
  const video = generatedVideos[0]?.['video'] as { uri?: string; videoBytes?: string } | undefined;
  if (!video) {
    throw new Error('Gemini video generation returned no video');
  }

  if (video.videoBytes) {
    const filePath = `${outputPathWithoutExt}.mp4`;
    writeFileSync(filePath, Buffer.from(video.videoBytes, 'base64'));
    return { filePath, metadata: { operationName, source: 'videoBytes' } };
  }

  if (video.uri) {
    const filePath = await downloadToFile(video.uri, outputPathWithoutExt);
    return { filePath, metadata: { operationName, source: 'uri' } };
  }

  throw new Error('Gemini video payload missing video bytes/uri');
}

export async function generateStep1(prompt: string): Promise<Step1Response> {
  const settings = getSettings();
  const { provider, model } = resolveTask('generateScript', settings);
  const key = getKey(provider, settings);

  const raw = provider === 'openai' ? await callOpenAiChat(model, prompt, key) : await callGeminiText(model, prompt, key);

  const parsed = JSON.parse(stripJsonFence(raw));
  return step1Schema.parse(parsed);
}

export async function validateProvider(provider: ProviderName, apiKey?: string): Promise<ValidateProviderResult> {
  const settings = getSettings();
  const key = apiKey?.trim() || settings.providerKeys[provider];
  if (!key) {
    return { ok: false, message: `Missing API key for ${provider}` };
  }

  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` }
      });
      await ensureOk(res, 'OpenAI key validation');
    } else {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      await ensureOk(res, 'Gemini key validation');
    }

    return { ok: true, message: `${provider} key is valid` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `Failed to validate ${provider}` };
  }
}

export async function listProviderModels(provider: ProviderName, apiKey?: string): Promise<string[]> {
  const settings = getSettings();
  const key = apiKey ?? getKey(provider, settings);

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    await ensureOk(res, 'OpenAI list models');

    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return [...new Set((data.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)))].sort();
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  await ensureOk(res, 'Gemini list models');
  const data = (await res.json()) as { models?: Array<{ name?: string }> };

  return [
    ...new Set(
      (data.models ?? [])
        .map((item) => item.name ?? '')
        .map((name) => name.replace(/^models\//, ''))
        .filter((name) => Boolean(name))
    )
  ].sort();
}

export async function generateImage(options: {
  projectId: string;
  entityType: 'character' | 'scene';
  entityId: string;
  prompt: string;
  references?: string[];
}): Promise<{ provider: ProviderName; model: string; filePath: string; metadataJson: string }> {
  const settings = getSettings();
  const mapping = resolveTask('generateImage', settings);
  const outputDir = getProjectAssetsDir(options.projectId);
  const outputPathWithoutExt = join(outputDir, `${options.entityType}-${options.entityId}-${Date.now()}`);
  const key = getKey(mapping.provider, settings);

  const generated =
    mapping.provider === 'openai'
      ? await openAiGenerateImage(mapping.model, options.prompt, key, outputPathWithoutExt)
      : await geminiGenerateImage(
          mapping.model,
          options.prompt,
          key,
          outputPathWithoutExt,
          options.references ?? []
        );
  const compressed = await archiveAndCompressGeneratedImage(generated.filePath, outputDir);

  return {
    provider: mapping.provider,
    model: mapping.model,
    filePath: compressed.filePath,
    metadataJson: JSON.stringify({
      prompt: options.prompt,
      references: options.references ?? [],
      providerMetadata: generated.metadata,
      compression: compressed.metadata
    })
  };
}

export async function generateVideoFromImage(options: {
  projectId: string;
  sceneId: string;
  prompt: string;
  firstFrameAssetId: string;
}): Promise<{ provider: ProviderName; model: string; filePath: string; metadataJson: string }> {
  const settings = getSettings();
  const mapping = resolveTask('generateVideo', settings);
  const outputDir = getProjectAssetsDir(options.projectId);
  const sourceAsset = getAsset(options.firstFrameAssetId);
  const extension = sourceAsset.filePath.split('.').pop() || 'bin';
  const copiedFrame = join(outputDir, `scene-${options.sceneId}-first-frame.${extension}`);
  copyFileSync(sourceAsset.filePath, copiedFrame);
  const key = getKey(mapping.provider, settings);
  const outputPathWithoutExt = join(outputDir, `scene-${options.sceneId}-video-${randomUUID()}`);

  const generated =
    mapping.provider === 'openai'
      ? await openAiGenerateVideoFromImage(mapping.model, options.prompt, copiedFrame, key, outputPathWithoutExt)
      : await geminiGenerateVideoFromImage(mapping.model, options.prompt, copiedFrame, key, outputPathWithoutExt);

  return {
    provider: mapping.provider,
    model: mapping.model,
    filePath: generated.filePath,
    metadataJson: JSON.stringify({
      prompt: options.prompt,
      firstFrameAssetId: options.firstFrameAssetId,
      providerMetadata: generated.metadata
    })
  };
}
