import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { GoogleGenAI } from '@google/genai';
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
const elevenLabsClients = new Map<string, ElevenLabsClient>();
const googleGenAiClients = new Map<string, GoogleGenAI>();

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
  const key = settings.providers.find((item) => item.name === provider)?.apiKey?.trim();
  if (!key) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  return key;
}

function resolveTask(task: GenerationTask, settings: AppSettings): { provider: ProviderName; model: string } {
  return settings.taskModelMappings[task];
}

function getCompatibleVideoModelsForProvider(provider: ProviderName, models: string[]): string[] {
  if (provider === 'openai') {
    return models.filter((model) => /(veo|video|sora)/i.test(model.trim()));
  }
  if (provider === 'gemini') {
    return models.filter((model) => /(veo|video)/i.test(model.trim()));
  }
  return [];
}

async function resolveVideoModel(
  provider: ProviderName,
  requestedModel: string,
  apiKey: string
): Promise<string> {
  const desired = requestedModel.trim();
  const available = await listProviderModels(provider, apiKey);
  const compatible = getCompatibleVideoModelsForProvider(provider, available);
  if (desired && compatible.includes(desired)) {
    return desired;
  }
  if (compatible.length > 0) {
    return compatible[0];
  }
  return desired;
}

function isHttp404Error(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\b404\b/.test(error.message);
}

function isGeminiUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('"status":"unavailable"') || /\b503\b/.test(message);
}

async function retryGeminiUnavailable<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isGeminiUnavailableError(error) || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = attempt * 2000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function ensureOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${await res.text()}`);
  }
}

async function formatHttpErrorDetails(res: Response, label: string): Promise<string> {
  const rawBody = await res.text();
  let parsedBody: unknown = null;
  if (rawBody.trim()) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = null;
    }
  }
  const detail = parsedBody
    ? JSON.stringify(parsedBody)
    : rawBody.trim() || '<empty response body>';
  return `${label} failed: ${res.status} ${res.statusText} (${res.url}) - ${detail}`;
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

function falAuthHeader(apiKey: string): string {
  return `Key ${apiKey}`;
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

async function falGenerateImage(
  model: string,
  prompt: string,
  apiKey: string,
  outputPathWithoutExt: string,
  referenceImagePaths: string[] = []
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const references = referenceImagePaths
    .map((imagePath) => {
      const bytes = readFileSync(imagePath);
      const mimeType = mimeTypeFromImagePath(imagePath);
      return `data:${mimeType};base64,${bytes.toString('base64')}`;
    })
    .filter((value) => Boolean(value));
  const body: Record<string, unknown> = {
    prompt
  };
  if (references.length > 0) {
    // fal models differ in input schema; provide common reference keys.
    body['image_url'] = references[0];
    body['control_image_url'] = references[0];
    body['reference_images'] = references;
  }
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: falAuthHeader(apiKey)
    },
    body: JSON.stringify(body)
  });
  await ensureOk(res, 'fal.ai image generation');

  const data = (await res.json()) as {
    images?: Array<{ url?: string; b64_json?: string }>;
    image?: { url?: string; b64_json?: string };
    seed?: number;
  };

  const first = data.images?.[0] ?? data.image;
  if (!first) {
    throw new Error('fal.ai image generation returned no image data');
  }

  if (first.b64_json) {
    const bytes = Buffer.from(first.b64_json, 'base64');
    const filePath = `${outputPathWithoutExt}.png`;
    writeFileSync(filePath, bytes);
    return {
      filePath,
      metadata: { output: 'b64_json', seed: data.seed, referenceCount: references.length }
    };
  }

  if (first.url) {
    const filePath = await downloadToFile(first.url, outputPathWithoutExt);
    return { filePath, metadata: { output: 'url', seed: data.seed, referenceCount: references.length } };
  }

  throw new Error('fal.ai image generation response missing b64_json/url');
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
  const firstFrameMime = mimeTypeFromImagePath(firstFrameAssetPath);
  const ai = (() => {
    const cached = googleGenAiClients.get(apiKey);
    if (cached) return cached;
    const created = new GoogleGenAI({ apiKey });
    googleGenAiClients.set(apiKey, created);
    return created;
  })();

  let operation = await retryGeminiUnavailable(() =>
    ai.models.generateVideos({
      model,
      prompt,
      image: {
        imageBytes: firstFrameBytes.toString('base64'),
        mimeType: firstFrameMime
      }
    })
  );

  const deadlineMs = Date.now() + 5 * 60 * 1000;
  while (!operation.done && Date.now() < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    operation = await retryGeminiUnavailable(() =>
      ai.operations.getVideosOperation({ operation })
    );
  }

  if (!operation.done) {
    throw new Error('Gemini video generation timed out');
  }
  const response = operation.response as
    | {
        generatedVideos?: Array<{ video?: { uri?: string; videoBytes?: string; bytesBase64Encoded?: string } }>;
        generateVideoResponse?: {
          generatedSamples?: Array<{ video?: { uri?: string; videoBytes?: string; bytesBase64Encoded?: string } }>;
        };
      }
    | undefined;
  const generatedVideo = response?.generatedVideos?.[0]?.video;
  const generatedSampleVideo =
    response?.generateVideoResponse?.generatedSamples?.[0]?.video;
  const video = {
    uri: generatedVideo?.uri ?? generatedSampleVideo?.uri,
    videoBytes:
      generatedVideo?.videoBytes ??
      generatedVideo?.bytesBase64Encoded ??
      generatedSampleVideo?.videoBytes ??
      generatedSampleVideo?.bytesBase64Encoded
  };
  if (!video.uri && !video.videoBytes) {
    throw new Error('Gemini video generation returned no video');
  }

  if (video.videoBytes) {
    const filePath = `${outputPathWithoutExt}.mp4`;
    writeFileSync(filePath, Buffer.from(video.videoBytes, 'base64'));
    return { filePath, metadata: { operationName: operation.name, source: 'videoBytes' } };
  }

  if (video.uri) {
    const videoUrl = video.uri.includes('key=')
      ? video.uri
      : `${video.uri}${video.uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
    const filePath = await downloadToFile(videoUrl, outputPathWithoutExt);
    return { filePath, metadata: { operationName: operation.name, source: 'uri' } };
  }

  throw new Error('Gemini video payload missing video bytes/uri');
}

export async function generateStep1(prompt: string): Promise<Step1Response> {
  const settings = getSettings();
  const { provider, model } = resolveTask('generateScript', settings);
  if (provider !== 'openai' && provider !== 'gemini') {
    throw new Error(`${provider} is currently not supported for script generation.`);
  }
  const key = getKey(provider, settings);

  const raw = provider === 'openai' ? await callOpenAiChat(model, prompt, key) : await callGeminiText(model, prompt, key);

  const parsed = JSON.parse(stripJsonFence(raw));
  return step1Schema.parse(parsed);
}

export async function validateProvider(provider: ProviderName, apiKey?: string): Promise<ValidateProviderResult> {
  const settings = getSettings();
  const key = apiKey?.trim() || settings.providers.find((item) => item.name === provider)?.apiKey?.trim();
  if (!key) {
    return { ok: false, message: `Missing API key for ${provider}` };
  }

  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` }
      });
      await ensureOk(res, 'OpenAI key validation');
    } else if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      await ensureOk(res, 'Gemini key validation');
    } else if (provider === 'fal') {
      const falValidationEndpoints = ['https://api.fal.ai/v1/models?limit=1', 'https://api.fal.ai/v1/models'];
      let validated = false;
      let lastError: string | null = null;
      for (const endpoint of falValidationEndpoints) {
        const res = await fetch(endpoint, {
          headers: { Authorization: falAuthHeader(key) }
        });
        if (res.ok) {
          validated = true;
          break;
        }
        const body = await res.text();
        const isHtml = /<!doctype html>/i.test(body);
        lastError = `fal.ai key validation failed: ${res.status} ${isHtml ? 'Unexpected HTML response from endpoint.' : body}`;
      }
      if (!validated) {
        throw new Error(lastError ?? 'fal.ai key validation failed.');
      }
    } else if (provider === 'elevenlabs') {
      const res = await fetch('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': key }
      });
      await ensureOk(res, 'ElevenLabs key validation');
    } else {
      return { ok: true, message: `${provider} key is saved (live validation is not implemented yet)` };
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

  if (provider === 'gemini') {
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

  if (provider === 'fal') {
    const falModelEndpoints = ['https://api.fal.ai/v1/models?limit=500', 'https://api.fal.ai/v1/models'];
    let lastError: unknown = null;

    for (const endpoint of falModelEndpoints) {
      try {
        const res = await fetch(endpoint, {
          headers: { Authorization: falAuthHeader(key) }
        });
        if (!res.ok) {
          throw new Error(await formatHttpErrorDetails(res, 'fal.ai list models'));
        }

        const payload = (await res.json()) as
          | Array<{ id?: string; model_id?: string; modelId?: string; name?: string }>
          | { models?: Array<{ id?: string; model_id?: string; modelId?: string; name?: string }> };
        const rows = Array.isArray(payload) ? payload : (payload.models ?? []);
        const ids = rows
          .map((item) => item.model_id ?? item.modelId ?? item.id ?? item.name ?? '')
          .map((value) => value.trim())
          .filter((value): value is string => Boolean(value));
        const fluxIds = ids.filter((value) => /(^|\/)flux([-/]|$)|\bflux\b/i.test(value));
        if (fluxIds.length > 0) {
          return [...new Set(fluxIds)].sort();
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `Failed to load fal.ai Flux models dynamically: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  if (provider === 'elevenlabs') {
    const res = await fetch('https://api.elevenlabs.io/v1/models', {
      headers: { 'xi-api-key': key }
    });
    await ensureOk(res, 'ElevenLabs list models');
    const payload = (await res.json()) as
      | Array<{ model_id?: string; modelId?: string; can_do_text_to_speech?: boolean }>
      | { models?: Array<{ model_id?: string; modelId?: string; can_do_text_to_speech?: boolean }> };
    const models = Array.isArray(payload) ? payload : (payload.models ?? []);

    return [
      ...new Set(
        models
          .filter((model) => model.can_do_text_to_speech !== false)
          .map((model) => model.model_id ?? model.modelId ?? '')
          .filter((modelId): modelId is string => Boolean(modelId))
      )
    ].sort();
  }

  return [];
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
      : mapping.provider === 'fal'
        ? await falGenerateImage(
          mapping.model,
          options.prompt,
          key,
          outputPathWithoutExt,
          options.references ?? []
        )
      : mapping.provider === 'gemini'
        ? await geminiGenerateImage(
          mapping.model,
          options.prompt,
          key,
          outputPathWithoutExt,
          options.references ?? []
        )
        : (() => {
            throw new Error(`${mapping.provider} is currently not supported for image generation.`);
          })();
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

  if (mapping.provider !== 'openai' && mapping.provider !== 'gemini') {
    throw new Error(`${mapping.provider} is currently not supported for video generation.`);
  }
  const resolvedModel = await resolveVideoModel(mapping.provider, mapping.model, key);
  if (!resolvedModel) {
    throw new Error(
      `${mapping.provider} has no compatible video model available. Validate the provider key and reload models in Settings.`
    );
  }
  let modelUsed = resolvedModel;
  const generated =
    mapping.provider === 'openai'
      ? await openAiGenerateVideoFromImage(resolvedModel, options.prompt, copiedFrame, key, outputPathWithoutExt)
      : mapping.provider === 'gemini'
        ? await (async () => {
            const available = await listProviderModels(mapping.provider, key);
            const compatible = getCompatibleVideoModelsForProvider(mapping.provider, available);
            const modelCandidates = [
              resolvedModel,
              ...compatible.filter((candidate) => candidate !== resolvedModel)
            ];
            let lastError: unknown = null;
            for (const candidate of modelCandidates) {
              try {
                modelUsed = candidate;
                return await geminiGenerateVideoFromImage(
                  candidate,
                  options.prompt,
                  copiedFrame,
                  key,
                  outputPathWithoutExt
                );
              } catch (error) {
                lastError = error;
                if (!isHttp404Error(error)) {
                  throw error;
                }
              }
            }
            throw new Error(
              `Gemini video generation failed for all compatible models: ${modelCandidates.join(', ')}`,
              {
                cause: lastError
              }
            );
          })()
        : (() => {
            throw new Error(`${mapping.provider} is currently not supported for video generation.`);
          })();

  return {
    provider: mapping.provider,
    model: modelUsed,
    filePath: generated.filePath,
    metadataJson: JSON.stringify({
      prompt: options.prompt,
      firstFrameAssetId: options.firstFrameAssetId,
      providerMetadata: generated.metadata
    })
  };
}

async function elevenLabsGenerateSpeech(
  model: string,
  text: string,
  apiKey: string,
  outputPathWithoutExt: string,
  voiceId: string,
  voiceSettings?: { speed?: number }
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const bytes = await synthesizeElevenLabsAudioBuffer({
    model,
    text,
    apiKey,
    voiceId,
    voiceSettings
  });
  const filePath = `${outputPathWithoutExt}.mp3`;
  writeFileSync(filePath, bytes);
  return { filePath, metadata: { voiceId, voiceSettings } };
}

function looksLikeElevenLabsModelId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('eleven-') || normalized.startsWith('eleven_');
}

function normalizeElevenLabsVoiceId(candidate: string | undefined, fallback: string): string {
  const raw = candidate?.trim() ?? '';
  if (!raw || looksLikeElevenLabsModelId(raw)) {
    return fallback;
  }
  return raw;
}

function getElevenLabsClient(apiKey: string): ElevenLabsClient {
  const existing = elevenLabsClients.get(apiKey);
  if (existing) {
    return existing;
  }
  const created = new ElevenLabsClient({ apiKey });
  elevenLabsClients.set(apiKey, created);
  return created;
}

async function toBuffer(audio: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(audio)) {
    return audio;
  }
  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }
  if (audio instanceof ArrayBuffer) {
    return Buffer.from(audio);
  }
  if (
    audio &&
    typeof audio === 'object' &&
    'arrayBuffer' in audio &&
    typeof (audio as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer === 'function'
  ) {
    const arrayBuffer = await (audio as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  if (
    audio &&
    typeof audio === 'object' &&
    Symbol.asyncIterator in audio &&
    typeof (audio as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of audio as AsyncIterable<unknown>) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(chunk));
      }
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks);
    }
  }
  throw new Error('ElevenLabs returned an unsupported audio payload type.');
}

function isInvalidVoiceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('invalid_uid') || normalized.includes('invalid id has been received');
}

async function listElevenLabsVoiceIds(apiKey: string): Promise<string[]> {
  const client = getElevenLabsClient(apiKey) as unknown as {
    voices?: { search?: () => Promise<{ voices?: Array<{ voiceId?: string; voice_id?: string }> }> };
  };
  const res = await client.voices?.search?.();
  const voices = res?.voices ?? [];
  return voices
    .map((voice) => voice.voiceId ?? voice.voice_id ?? '')
    .filter((voiceId): voiceId is string => Boolean(voiceId));
}

async function synthesizeElevenLabsAudioBuffer(options: {
  model: string;
  text: string;
  apiKey: string;
  voiceId: string;
  voiceSettings?: { speed?: number };
}): Promise<Buffer> {
  const client = getElevenLabsClient(options.apiKey);
  const audio = await client.textToSpeech.convert(options.voiceId, {
    text: options.text,
    modelId: options.model,
    ...(options.voiceSettings ? { voiceSettings: options.voiceSettings } : {})
  });
  return toBuffer(audio);
}

export async function synthesizeElevenLabsSpeechPreview(options: {
  model: string;
  text: string;
  apiKey: string;
  voiceId: string;
  voiceSettings?: { speed?: number };
}): Promise<string> {
  const defaultVoiceId = 'EXAVITQu4vr4xnSDxMaL';
  const primaryVoiceId = normalizeElevenLabsVoiceId(options.voiceId, defaultVoiceId);
  let resolvedVoiceId = primaryVoiceId;
  try {
    const availableVoiceIds = await listElevenLabsVoiceIds(options.apiKey);
    if (availableVoiceIds.length > 0 && !availableVoiceIds.includes(primaryVoiceId)) {
      resolvedVoiceId = availableVoiceIds.includes(defaultVoiceId) ? defaultVoiceId : availableVoiceIds[0];
    }
  } catch {
    // If voice listing fails, continue with fallback logic below.
  }
  let bytes: Buffer;
  try {
    bytes = await synthesizeElevenLabsAudioBuffer({
      model: options.model,
      text: options.text,
      apiKey: options.apiKey,
      voiceId: resolvedVoiceId,
      voiceSettings: options.voiceSettings
    });
  } catch (error) {
    if (isInvalidVoiceError(error)) {
      try {
        bytes = await synthesizeElevenLabsAudioBuffer({
          model: options.model,
          text: options.text,
          apiKey: options.apiKey,
          voiceId: defaultVoiceId,
          voiceSettings: options.voiceSettings
        });
      } catch (defaultError) {
        if (!isInvalidVoiceError(defaultError)) {
          throw new Error(
            `ElevenLabs voice preview failed: ${defaultError instanceof Error ? defaultError.message : String(defaultError)}`,
            { cause: defaultError }
          );
        }
        const availableVoiceIds = await listElevenLabsVoiceIds(options.apiKey);
        const fallbackVoiceId = availableVoiceIds[0];
        if (!fallbackVoiceId) {
          throw new Error(
            `ElevenLabs voice preview failed: ${defaultError instanceof Error ? defaultError.message : String(defaultError)}`,
            { cause: defaultError }
          );
        }
        bytes = await synthesizeElevenLabsAudioBuffer({
          model: options.model,
          text: options.text,
          apiKey: options.apiKey,
          voiceId: fallbackVoiceId,
          voiceSettings: options.voiceSettings
        });
      }
    } else {
      throw new Error(`ElevenLabs voice preview failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error
      });
    }
  }

  return `data:audio/mpeg;base64,${bytes.toString('base64')}`;
}

export async function generateSpeech(options: {
  projectId: string;
  text: string;
  segments?: Array<{ text: string; voiceId?: string }>;
  voiceSettings?: { speed?: number };
}): Promise<{ provider: ProviderName; model: string; filePath: string; metadataJson: string }> {
  const settings = getSettings();
  const mapping = resolveTask('textToSpeech', settings);
  if (mapping.provider !== 'elevenlabs') {
    throw new Error(`${mapping.provider} is currently not supported for speech generation.`);
  }
  const outputDir = getProjectAssetsDir(options.projectId);
  const outputPathWithoutExt = join(outputDir, `speech-${randomUUID()}`);
  const key = getKey(mapping.provider, settings);
  const defaultVoiceId = normalizeElevenLabsVoiceId(
    settings.elevenLabsVoiceId,
    'EXAVITQu4vr4xnSDxMaL'
  );
  let generated: { filePath: string; metadata: Record<string, unknown> };
  if (options.segments && options.segments.length > 0) {
    const chunks: Buffer[] = [];
    const usedVoiceIds: string[] = [];
    for (const segment of options.segments) {
      const segmentText = segment.text?.trim();
      if (!segmentText) continue;
      const voiceId = normalizeElevenLabsVoiceId(segment.voiceId, defaultVoiceId);
      const preview = await synthesizeElevenLabsSpeechPreview({
        model: mapping.model,
        text: segmentText,
        apiKey: key,
        voiceId,
        voiceSettings: options.voiceSettings
      });
      const base64 = preview.replace(/^data:audio\/mpeg;base64,/, '');
      chunks.push(Buffer.from(base64, 'base64'));
      usedVoiceIds.push(voiceId);
    }
    if (chunks.length === 0) {
      throw new Error('No transcript content to synthesize.');
    }
    const filePath = `${outputPathWithoutExt}.mp3`;
    writeFileSync(filePath, Buffer.concat(chunks));
    generated = {
      filePath,
      metadata: {
        voiceIds: [...new Set(usedVoiceIds)],
        segmentCount: chunks.length
      }
    };
  } else {
    generated = await elevenLabsGenerateSpeech(
      mapping.model,
      options.text,
      key,
      outputPathWithoutExt,
      defaultVoiceId,
      options.voiceSettings
    );
  }

  return {
    provider: mapping.provider,
    model: mapping.model,
    filePath: generated.filePath,
    metadataJson: JSON.stringify({
      textLength: options.text.length,
      providerMetadata: generated.metadata
    })
  };
}
