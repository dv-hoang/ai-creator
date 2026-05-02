import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createFalClient } from "@fal-ai/client";
import { GoogleGenAI } from "@google/genai";
import { falFluxReferencesForGenerateImage } from "../shared/falFluxImageGeneration";
import { falModelsForGenerationTask } from "../shared/falModelFilters";
import type {
  AppSettings,
  GenerationTask,
  ProviderName,
  Step1Response,
  TaskModelMapping,
  ValidateProviderResult,
} from "@shared/types";
import {
  getAsset,
  getProjectAssetsDir,
  getSettings,
  recordProviderValidation,
} from "./db";
import { step1Schema } from "./schemas";
import { stripJsonFence } from "./template";

type SharpLike = (input: string) => {
  rotate: () => ReturnType<SharpLike>;
  resize: (
    widthOrOptions: number | Record<string, unknown>,
    height?: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ) => ReturnType<SharpLike>;
  webp: (options: { quality: number; effort: number }) => ReturnType<SharpLike>;
  toFile: (path: string) => Promise<unknown>;
};

let cachedSharp: SharpLike | null = null;
let sharpLoadError: string | null = null;
const elevenLabsClients = new Map<string, ElevenLabsClient>();
const googleGenAiClients = new Map<string, GoogleGenAI>();

/** Max width/height for character images (fit inside, preserve aspect, no upscale). */
export const CHARACTER_IMAGE_MAX_EDGE_PX = 1536;

async function loadSharp(): Promise<SharpLike | null> {
  if (cachedSharp) {
    return cachedSharp;
  }
  if (sharpLoadError) {
    return null;
  }

  try {
    const mod = await import("sharp");
    const candidate = (mod.default ?? mod) as unknown;
    if (typeof candidate !== "function") {
      sharpLoadError = "sharp export is not callable";
      return null;
    }
    cachedSharp = candidate as SharpLike;
    return cachedSharp;
  } catch (error) {
    sharpLoadError =
      error instanceof Error ? error.message : "failed to load sharp";
    return null;
  }
}

function getKey(provider: ProviderName, settings: AppSettings): string {
  const key = settings.providers
    .find((item) => item.name === provider)
    ?.apiKey?.trim();
  if (!key) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  return key;
}

function resolveTask(
  task: GenerationTask,
  settings: AppSettings,
): { provider: ProviderName; model: string } {
  return settings.taskModelMappings[task];
}

function resolveTaskMapping(
  task: GenerationTask,
  settings: AppSettings,
  override?: TaskModelMapping,
): { provider: ProviderName; model: string } {
  return override ?? resolveTask(task, settings);
}

function getCompatibleVideoModelsForProvider(
  provider: ProviderName,
  models: string[],
  falCategories?: AppSettings["falModelCategories"],
): string[] {
  if (provider === "openai") {
    return models.filter((model) => /(veo|video|sora)/i.test(model.trim()));
  }
  if (provider === "gemini") {
    return models.filter((model) => /(veo|video)/i.test(model.trim()));
  }
  if (provider === "fal") {
    return falModelsForGenerationTask("generateVideo", models, falCategories);
  }
  return [];
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
  maxAttempts = 3,
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

async function formatHttpErrorDetails(
  res: Response,
  label: string,
): Promise<string> {
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
    : rawBody.trim() || "<empty response body>";
  return `${label} failed: ${res.status} ${res.statusText} (${res.url}) - ${detail}`;
}

async function callOpenAiChat(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  await ensureOk(res, "OpenAI chat completion");

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

async function callGeminiText(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 },
    }),
  });

  await ensureOk(res, "Gemini generateContent");

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n") ?? ""
  );
}

function falAuthHeader(apiKey: string): string {
  return `Key ${apiKey}`;
}

function pickImageExtension(
  contentType: string | null,
  fallback = "png",
): string {
  if (!contentType) {
    return fallback;
  }
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("mp4")) return "mp4";
  return fallback;
}

function mimeTypeFromImagePath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".bmp") return "image/bmp";
  return "image/png";
}

async function downloadToFile(
  url: string,
  outputPathWithoutExt: string,
): Promise<string> {
  const res = await fetch(url);
  await ensureOk(res, "Asset download");
  const extension = pickImageExtension(res.headers.get("content-type"));
  const bytes = Buffer.from(await res.arrayBuffer());
  const filePath = `${outputPathWithoutExt}.${extension}`;
  writeFileSync(filePath, bytes);
  return filePath;
}

async function downloadVideoToFile(
  url: string,
  outputPathWithoutExt: string,
): Promise<string> {
  const res = await fetch(url);
  await ensureOk(res, "fal video download");
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = ct.includes("webm")
    ? "webm"
    : ct.includes("quicktime") || ct.includes("mov")
      ? "mov"
      : "mp4";
  const filePath = `${outputPathWithoutExt}.${ext}`;
  writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
  return filePath;
}

function isHttpMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function pickFirstVideoUrlFromFalPayload(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const queue: unknown[] = [data];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === null || node === undefined) {
      continue;
    }
    if (typeof node !== "object") {
      continue;
    }
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        queue.push(item);
      }
      continue;
    }
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && isHttpMediaUrl(value)) {
        const lower = value.toLowerCase();
        const keyLower = key.toLowerCase();
        if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) {
          return value;
        }
        if (
          keyLower.includes("video") ||
          /video|mp4|webm|mime=video/.test(lower)
        ) {
          return value;
        }
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return undefined;
}

async function archiveAndCompressGeneratedImage(
  filePath: string,
  projectAssetsDir: string,
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const sharp = await loadSharp();
  if (!sharp) {
    return {
      filePath,
      metadata: {
        compressed: false,
        reason: "sharp_unavailable",
        detail: sharpLoadError ?? "sharp module could not be loaded",
      },
    };
  }

  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg", "webp"].includes(extension)) {
    return {
      filePath,
      metadata: { compressed: false, reason: "unsupported_format" },
    };
  }

  const originDir = join(projectAssetsDir, "origin");
  const compressedDir = join(projectAssetsDir, "compressed");
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
    .resize(CHARACTER_IMAGE_MAX_EDGE_PX, CHARACTER_IMAGE_MAX_EDGE_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
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
      targetFormat: "webp",
      beforeBytes,
      afterBytes,
      reductionPercent:
        beforeBytes > 0
          ? Number(
              (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2),
            )
          : 0,
      archivedOriginalPath,
      compressedPath,
    },
  };
}

/**
 * Read-only on source: compress an arbitrary image into a project's assets/compressed folder
 * (same pipeline as generated images) for global → project character mapping.
 */
export async function compressCopyImageForCharacterMapping(
  absoluteSourcePath: string,
  projectAssetsDir: string,
  fileNameBase: string,
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error(sharpLoadError ?? "sharp module could not be loaded");
  }

  const extension = absoluteSourcePath.split(".").pop()?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension)) {
    throw new Error(`Unsupported image format for mapping: .${extension}`);
  }

  const compressedDir = join(projectAssetsDir, "compressed");
  mkdirSync(compressedDir, { recursive: true });
  const compressedPath = join(compressedDir, `${fileNameBase}.webp`);
  const tempPath = `${compressedPath}.tmp`;
  const beforeBytes = statSync(absoluteSourcePath).size;

  await sharp(absoluteSourcePath)
    .rotate()
    .resize(CHARACTER_IMAGE_MAX_EDGE_PX, CHARACTER_IMAGE_MAX_EDGE_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 6 })
    .toFile(tempPath);

  renameSync(tempPath, compressedPath);

  const afterBytes = statSync(compressedPath).size;
  return {
    filePath: compressedPath,
    metadata: {
      compressed: true,
      sourceFormat: extension,
      targetFormat: "webp",
      mapped: true,
      maxEdgePx: CHARACTER_IMAGE_MAX_EDGE_PX,
      fit: "inside",
      beforeBytes,
      afterBytes,
      reductionPercent:
        beforeBytes > 0
          ? Number(
              (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2),
            )
          : 0,
    },
  };
}

/** Store a compressed .webp under the global characters library folder. */
export async function compressImageToLibraryWebp(
  absoluteSourcePath: string,
  outputWebpFullPath: string,
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const sharp = await loadSharp();
  if (!sharp) {
    throw new Error(sharpLoadError ?? "sharp module could not be loaded");
  }

  const extension = absoluteSourcePath.split(".").pop()?.toLowerCase() ?? "";
  if (!["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension)) {
    throw new Error(`Unsupported image format for upload: .${extension}`);
  }

  mkdirSync(dirname(outputWebpFullPath), { recursive: true });
  const tempPath = `${outputWebpFullPath}.tmp`;
  const beforeBytes = statSync(absoluteSourcePath).size;

  await sharp(absoluteSourcePath)
    .rotate()
    .resize(CHARACTER_IMAGE_MAX_EDGE_PX, CHARACTER_IMAGE_MAX_EDGE_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 6 })
    .toFile(tempPath);

  renameSync(tempPath, outputWebpFullPath);

  const afterBytes = statSync(outputWebpFullPath).size;
  return {
    filePath: outputWebpFullPath,
    metadata: {
      compressed: true,
      uploaded: true,
      maxEdgePx: CHARACTER_IMAGE_MAX_EDGE_PX,
      fit: "inside",
      sourceFormat: extension,
      targetFormat: "webp",
      beforeBytes,
      afterBytes,
      reductionPercent:
        beforeBytes > 0
          ? Number(
              (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2),
            )
          : 0,
    },
  };
}

async function openAiGenerateImage(
  model: string,
  prompt: string,
  apiKey: string,
  outputPathWithoutExt: string,
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });
  await ensureOk(res, "OpenAI image generation");

  const data = (await res.json()) as {
    created?: number;
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const first = data.data?.[0];
  if (!first) {
    throw new Error("OpenAI image generation returned no image data");
  }

  if (first.b64_json) {
    const bytes = Buffer.from(first.b64_json, "base64");
    const filePath = `${outputPathWithoutExt}.png`;
    writeFileSync(filePath, bytes);
    return {
      filePath,
      metadata: { created: data.created, output: "b64_json" },
    };
  }

  if (first.url) {
    const filePath = await downloadToFile(first.url, outputPathWithoutExt);
    return { filePath, metadata: { created: data.created, output: "url" } };
  }

  throw new Error("OpenAI image generation response missing b64_json/url");
}

async function geminiGenerateImage(
  model: string,
  prompt: string,
  apiKey: string,
  outputPathWithoutExt: string,
  referenceImagePaths: string[] = [],
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestParts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const imagePath of referenceImagePaths) {
    const imageBytes = readFileSync(imagePath);
    requestParts.push({
      inlineData: {
        mimeType: mimeTypeFromImagePath(imagePath),
        data: imageBytes.toString("base64"),
      },
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: requestParts }],
    }),
  });
  await ensureOk(res, "Gemini image generation");

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
    parts.find((p) => p.inline_data?.data)?.inline_data ??
    parts.find((p) => p.inlineData?.data)?.inlineData;

  if (!inline?.data) {
    throw new Error(
      "Gemini image generation did not return inline image bytes",
    );
  }

  let inlineMimeType: string | undefined;
  if ("mime_type" in inline) {
    inlineMimeType = inline.mime_type;
  } else if ("mimeType" in inline) {
    inlineMimeType = inline.mimeType;
  }
  const extension = pickImageExtension(inlineMimeType ?? "image/png");
  const filePath = `${outputPathWithoutExt}.${extension}`;
  writeFileSync(filePath, Buffer.from(inline.data, "base64"));
  return { filePath, metadata: { mimeType: inlineMimeType } };
}

function imageFilePathToFalDataUrl(imagePath: string): string {
  const bytes = readFileSync(imagePath);
  const mimeType = mimeTypeFromImagePath(imagePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

/** Remove duplicate filesystem paths while preserving caller order */
function uniqByResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = resolvePath(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Paths for character/scene refs: exclude duplicates of `firstFramePath` */
function falVideoReferencePathsExcludingFirst(
  firstFramePath: string,
  extraPaths: string[],
): string[] {
  const firstKey = resolvePath(firstFramePath);
  return uniqByResolvedPaths(extraPaths).filter((p) => resolvePath(p) !== firstKey);
}

async function falGenerateImage(
  model: string,
  prompt: string,
  apiKey: string,
  outputPathWithoutExt: string,
  referenceImagePaths: string[] = [],
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const references = uniqByResolvedPaths(referenceImagePaths).map(
    imageFilePathToFalDataUrl,
  );
  const input: Record<string, unknown> = { prompt };
  if (references.length > 0) {
    // fal Flux / editing models vary; scatter common keys (extras are ignored by strict schemas).
    input["image_url"] = references[0];
    input["control_image_url"] = references[0];
    input["reference_images"] = references;
    input["reference_image_urls"] = references;
    input["input_image_url"] = references[0];
  }

  const fal = createFalClient({ credentials: apiKey });
  let result: { data: unknown };
  try {
    result = await fal.subscribe(model, { input });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`fal.ai image generation failed: ${message}`, {
      cause: err,
    });
  }

  const data = result.data as {
    images?: Array<{ url?: string; b64_json?: string }>;
    image?: { url?: string; b64_json?: string };
    seed?: number;
  };

  const first = data.images?.[0] ?? data.image;
  if (!first) {
    throw new Error("fal.ai image generation returned no image data");
  }

  if (first.b64_json) {
    const bytes = Buffer.from(first.b64_json, "base64");
    const filePath = `${outputPathWithoutExt}.png`;
    writeFileSync(filePath, bytes);
    return {
      filePath,
      metadata: {
        output: "b64_json",
        seed: data.seed,
        referenceCount: references.length,
      },
    };
  }

  if (first.url) {
    const filePath = await downloadToFile(first.url, outputPathWithoutExt);
    return {
      filePath,
      metadata: {
        output: "url",
        seed: data.seed,
        referenceCount: references.length,
      },
    };
  }

  throw new Error("fal.ai image generation response missing b64_json/url");
}

async function falGenerateVideoFromImage(
  model: string,
  prompt: string,
  firstFrameAssetPath: string,
  apiKey: string,
  outputPathWithoutExt: string,
  additionalReferenceImagePaths: string[] = [],
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const primary = imageFilePathToFalDataUrl(firstFrameAssetPath);
  const refPaths = falVideoReferencePathsExcludingFirst(
    firstFrameAssetPath,
    additionalReferenceImagePaths,
  );
  const refDataUrls = refPaths.map((p) => imageFilePathToFalDataUrl(p));
  const imageUrls =
    refDataUrls.length > 0 ? [primary, ...refDataUrls] : [primary];
  const input: Record<string, unknown> = {
    prompt,
    image_url: primary,
    image_urls: imageUrls,
    start_image_url: primary,
    first_frame_url: primary,
    input_image: primary,
  };
  if (refDataUrls.length > 0) {
    // fal Flux / i2v models vary; mirrors image-gen reference keys plus common aliases.
    input["reference_images"] = refDataUrls;
    input["reference_image_urls"] = refDataUrls;
  }

  const fal = createFalClient({ credentials: apiKey });
  let result: { data: unknown };
  try {
    result = await fal.subscribe(model, { input });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`fal.ai video generation failed: ${message}`, {
      cause: err,
    });
  }

  const url = pickFirstVideoUrlFromFalPayload(result.data);
  if (!url) {
    throw new Error(
      "fal.ai video generation returned no video URL (response shape may differ for this model)",
    );
  }

  const filePath = await downloadVideoToFile(url, outputPathWithoutExt);
  return {
    filePath,
    metadata: {
      output: "url",
      source: "fal.ai",
      extraReferenceCount: refDataUrls.length,
    },
  };
}

async function openAiGenerateVideoFromImage(
  model: string,
  prompt: string,
  firstFrameAssetPath: string,
  apiKey: string,
  outputPathWithoutExt: string,
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const firstFrameBytes = readFileSync(firstFrameAssetPath);
  const imageBase64 = firstFrameBytes.toString("base64");

  const createRes = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      image: imageBase64,
    }),
  });
  await ensureOk(createRes, "OpenAI video create");
  const created = (await createRes.json()) as { id?: string; status?: string };
  if (!created.id) {
    throw new Error("OpenAI video create did not return an id");
  }

  const deadlineMs = Date.now() + 5 * 60 * 1000;
  let status = created.status ?? "queued";
  while (
    Date.now() < deadlineMs &&
    (status === "queued" || status === "in_progress")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const retrieveRes = await fetch(
      `https://api.openai.com/v1/videos/${created.id}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    await ensureOk(retrieveRes, "OpenAI video status");
    const retrieved = (await retrieveRes.json()) as {
      status?: string;
      progress?: number;
    };
    status = retrieved.status ?? "failed";
  }

  if (status !== "completed") {
    throw new Error(
      `OpenAI video generation did not complete (status=${status})`,
    );
  }

  const contentRes = await fetch(
    `https://api.openai.com/v1/videos/${created.id}/content`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  await ensureOk(contentRes, "OpenAI video download");
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
  outputPathWithoutExt: string,
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
        imageBytes: firstFrameBytes.toString("base64"),
        mimeType: firstFrameMime,
      },
    }),
  );

  const deadlineMs = Date.now() + 5 * 60 * 1000;
  while (!operation.done && Date.now() < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    operation = await retryGeminiUnavailable(() =>
      ai.operations.getVideosOperation({ operation }),
    );
  }

  if (!operation.done) {
    throw new Error("Gemini video generation timed out");
  }
  const response = operation.response as
    | {
        generatedVideos?: Array<{
          video?: {
            uri?: string;
            videoBytes?: string;
            bytesBase64Encoded?: string;
          };
        }>;
        generateVideoResponse?: {
          generatedSamples?: Array<{
            video?: {
              uri?: string;
              videoBytes?: string;
              bytesBase64Encoded?: string;
            };
          }>;
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
      generatedSampleVideo?.bytesBase64Encoded,
  };
  if (!video.uri && !video.videoBytes) {
    throw new Error("Gemini video generation returned no video");
  }

  if (video.videoBytes) {
    const filePath = `${outputPathWithoutExt}.mp4`;
    writeFileSync(filePath, Buffer.from(video.videoBytes, "base64"));
    return {
      filePath,
      metadata: { operationName: operation.name, source: "videoBytes" },
    };
  }

  if (video.uri) {
    const videoUrl = video.uri.includes("key=")
      ? video.uri
      : `${video.uri}${video.uri.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
    const filePath = await downloadToFile(videoUrl, outputPathWithoutExt);
    return {
      filePath,
      metadata: { operationName: operation.name, source: "uri" },
    };
  }

  throw new Error("Gemini video payload missing video bytes/uri");
}

export async function generateStep1(prompt: string): Promise<Step1Response> {
  const settings = getSettings();
  const { provider, model } = resolveTask("generateScript", settings);
  if (provider !== "openai" && provider !== "gemini") {
    throw new Error(
      `${provider} is currently not supported for script generation.`,
    );
  }
  const key = getKey(provider, settings);

  const raw =
    provider === "openai"
      ? await callOpenAiChat(model, prompt, key)
      : await callGeminiText(model, prompt, key);

  const parsed = JSON.parse(stripJsonFence(raw));
  return step1Schema.parse(parsed);
}

/** Optional Step 1b: tighten continuity and prompts; same provider/model as generateScript. */
export async function refineStep1Response(
  parsed: Step1Response,
): Promise<Step1Response> {
  const settings = getSettings();
  const { provider, model } = resolveTask("generateScript", settings);
  if (provider !== "openai" && provider !== "gemini") {
    throw new Error(
      `${provider} is currently not supported for script refinement.`,
    );
  }
  const key = getKey(provider, settings);
  const refinementPrompt = `You are a senior animation pipeline editor. You receive JSON that already matches the AI Creator Step 1 animation schema.

Improve without changing the story:
- Align character names: every string in scenes[].characters_present must match a characters[].name exactly.
- Continuity: wardrobe, hair, age, signature props, and palette must stay consistent across scenes in image_prompt and image_to_video_prompt.
- image_to_video_prompt: keep time-slice format; ensure full coverage from 0s through clip_duration_sec with no gaps or overlaps; clearer motion and motivated camera where possible.
- Strengthen lighting/lens vocabulary in image_prompt where weak.
- Preserve clip_duration_sec unless a clear error exists (then fix with minimal change).

Return ONLY one JSON object using the same schema (same required keys). No markdown fences, no commentary.

INPUT JSON:
${JSON.stringify(parsed)}`;

  const raw =
    provider === "openai"
      ? await callOpenAiChat(model, refinementPrompt, key)
      : await callGeminiText(model, refinementPrompt, key);
  const out = JSON.parse(stripJsonFence(raw));
  return step1Schema.parse(out);
}

export async function validateProvider(
  provider: ProviderName,
  apiKey?: string,
): Promise<ValidateProviderResult> {
  const settings = getSettings();
  const key =
    apiKey?.trim() ||
    settings.providers.find((item) => item.name === provider)?.apiKey?.trim();
  if (!key) {
    return { ok: false, message: `Missing API key for ${provider}` };
  }

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      await ensureOk(res, "OpenAI key validation");
    } else if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      await ensureOk(res, "Gemini key validation");
    } else if (provider === "fal") {
      const res = await fetch("https://api.fal.ai/v1/models", {
        headers: { Authorization: falAuthHeader(key) },
      });
      if (res.ok) {
        return { ok: true, message: `${provider} key is valid` };
      }
      return {
        ok: false,
        message: `fal.ai key validation failed: ${res.status} ${await res.text()}`,
      };
    } else if (provider === "elevenlabs") {
      const res = await fetch("https://api.elevenlabs.io/v1/models", {
        headers: { "xi-api-key": key },
      });
      await ensureOk(res, "ElevenLabs key validation");
    } else {
      recordProviderValidation(provider, key);
      return {
        ok: true,
        message: `${provider} key is saved (live validation is not implemented yet)`,
      };
    }

    recordProviderValidation(provider, key);
    return { ok: true, message: `${provider} key is valid` };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : `Failed to validate ${provider}`,
    };
  }
}

export async function fetchFalModelCatalog(apiKey: string): Promise<{
  modelIds: string[];
  falCategories: Record<string, "image" | "video">;
}> {
  const baseUrl = "https://api.fal.ai/v1/models";
  const pageLimit = 500;
  const maxPages = 500;

  const extractModelRows = (payload: unknown): Record<string, unknown>[] => {
    if (Array.isArray(payload)) {
      return payload.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object",
      );
    }
    if (payload && typeof payload === "object") {
      const o = payload as Record<string, unknown>;
      for (const rowKey of ["models", "data", "items", "results"] as const) {
        const arr = o[rowKey];
        if (Array.isArray(arr)) {
          return arr.filter(
            (row): row is Record<string, unknown> =>
              Boolean(row) && typeof row === "object",
          );
        }
      }
    }
    return [];
  };

  const pickEndpointId = (item: Record<string, unknown>): string => {
    const candidates = [
      item.endpoint_id,
      item.endpointId,
      item.model_id,
      item.modelId,
      item.id,
      item.name,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        return c.trim();
      }
    }
    return "";
  };

  const classifyRow = (
    item: Record<string, unknown>,
  ): "image" | "video" | null => {
    const meta = item.metadata;
    if (!meta || typeof meta !== "object") {
      return null;
    }
    const raw = (meta as Record<string, unknown>).category;
    if (typeof raw !== "string" || !raw.trim()) {
      return null;
    }
    const c = raw.trim().toLowerCase();
    if (c === "text-to-image" || c === "image-to-image") {
      return "image";
    }
    if (
      c === "text-to-video" ||
      c === "image-to-video" ||
      c === "video-to-video"
    ) {
      return "video";
    }
    return null;
  };

  const collected: string[] = [];
  const falCategories: Record<string, "image" | "video"> = {};
  let cursor: string | undefined;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(baseUrl);
    url.searchParams.set("limit", String(pageLimit));
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: falAuthHeader(apiKey) },
    });
    if (!res.ok) {
      throw new Error(await formatHttpErrorDetails(res, "fal.ai list models"));
    }

    const payload: unknown = await res.json();
    const rows = extractModelRows(payload);
    for (const row of rows) {
      const id = pickEndpointId(row);
      const kind = classifyRow(row);
      if (!id || !kind) {
        continue;
      }
      collected.push(id);
      falCategories[id] = kind;
    }

    const meta =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;
    const hasMore = Boolean(meta?.has_more);
    const nextCursor =
      typeof meta?.next_cursor === "string" ? meta.next_cursor.trim() : "";
    if (!hasMore || !nextCursor) {
      break;
    }
    if (page === maxPages - 1) {
      truncated = true;
      break;
    }
    cursor = nextCursor;
  }

  if (truncated) {
    throw new Error(
      `fal.ai list models: pagination exceeded safety limit (${maxPages} requests)`,
    );
  }

  const modelIds = [...new Set(collected)].sort();

  if (modelIds.length === 0) {
    throw new Error(
      "fal.ai list models: no image or video generation endpoints found (check catalog or API key)",
    );
  }

  return { modelIds, falCategories };
}

export async function listProviderModels(
  provider: ProviderName,
  apiKey?: string,
): Promise<string[]> {
  const settings = getSettings();
  const key = apiKey ?? getKey(provider, settings);

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    await ensureOk(res, "OpenAI list models");

    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return [
      ...new Set(
        (data.data ?? [])
          .map((item) => item.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();
  }

  if (provider === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    await ensureOk(res, "Gemini list models");
    const data = (await res.json()) as { models?: Array<{ name?: string }> };

    return [
      ...new Set(
        (data.models ?? [])
          .map((item) => item.name ?? "")
          .map((name) => name.replace(/^models\//, ""))
          .filter((name) => Boolean(name)),
      ),
    ].sort();
  }

  if (provider === "fal") {
    const { modelIds } = await fetchFalModelCatalog(key);
    return modelIds;
  }

  if (provider === "elevenlabs") {
    const res = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": key },
    });
    await ensureOk(res, "ElevenLabs list models");
    const payload = (await res.json()) as
      | Array<{
          model_id?: string;
          modelId?: string;
          can_do_text_to_speech?: boolean;
        }>
      | {
          models?: Array<{
            model_id?: string;
            modelId?: string;
            can_do_text_to_speech?: boolean;
          }>;
        };
    const models = Array.isArray(payload) ? payload : (payload.models ?? []);

    return [
      ...new Set(
        models
          .filter((model) => model.can_do_text_to_speech !== false)
          .map((model) => model.model_id ?? model.modelId ?? "")
          .filter((modelId): modelId is string => Boolean(modelId)),
      ),
    ].sort();
  }

  return [];
}

export async function generateImage(options: {
  projectId: string;
  entityType: "character" | "scene" | "solo";
  entityId: string;
  prompt: string;
  references?: string[];
  /** Per-call provider/model (e.g. Solo workspace picker). */
  taskMapping?: TaskModelMapping;
}): Promise<{
  provider: ProviderName;
  model: string;
  filePath: string;
  metadataJson: string;
}> {
  const settings = getSettings();
  const mapping = resolveTaskMapping(
    "generateImage",
    settings,
    options.taskMapping,
  );
  const outputDir = getProjectAssetsDir(options.projectId);
  const outputPathWithoutExt = join(
    outputDir,
    `${options.entityType}-${options.entityId}-${Date.now()}`,
  );
  const key = getKey(mapping.provider, settings);

  const falRefs = falFluxReferencesForGenerateImage(
    options.entityType,
    options.references,
  );

  const generated =
    mapping.provider === "openai"
      ? await openAiGenerateImage(
          mapping.model,
          options.prompt,
          key,
          outputPathWithoutExt,
        )
      : mapping.provider === "fal"
        ? await falGenerateImage(
            mapping.model,
            options.prompt,
            key,
            outputPathWithoutExt,
            falRefs,
          )
        : mapping.provider === "gemini"
          ? await geminiGenerateImage(
              mapping.model,
              options.prompt,
              key,
              outputPathWithoutExt,
              options.references ?? [],
            )
          : (() => {
              throw new Error(
                `${mapping.provider} is currently not supported for image generation.`,
              );
            })();
  const compressed = await archiveAndCompressGeneratedImage(
    generated.filePath,
    outputDir,
  );

  return {
    provider: mapping.provider,
    model: mapping.model,
    filePath: compressed.filePath,
    metadataJson: JSON.stringify({
      prompt: options.prompt,
      references: options.references ?? [],
      providerMetadata: generated.metadata,
      compression: compressed.metadata,
    }),
  };
}

export async function generateVideoFromImage(options: {
  projectId: string;
  sceneId: string;
  prompt: string;
  /** Use DB asset as first frame (standard scene / solo generated image). */
  firstFrameAssetId?: string;
  /**
   * Absolute path to a first-frame image (e.g. Solo uploaded reference).
   * Mutually exclusive with `firstFrameAssetId` for frame resolution.
   */
  firstFrameSourcePath?: string;
  /** Character reference images for providers that support extras (fal Flux i2v). */
  referenceImagePaths?: string[];
  taskMapping?: TaskModelMapping;
  /** Solo workspace uses stable file prefixes instead of scene ids. */
  outputVariant?: "scene" | "solo";
}): Promise<{
  provider: ProviderName;
  model: string;
  filePath: string;
  metadataJson: string;
}> {
  const settings = getSettings();
  const mapping = resolveTaskMapping(
    "generateVideo",
    settings,
    options.taskMapping,
  );
  const outputDir = getProjectAssetsDir(options.projectId);
  let frameDiskPath: string;
  if (options.firstFrameSourcePath?.trim()) {
    frameDiskPath = resolvePath(options.firstFrameSourcePath.trim());
    if (!existsSync(frameDiskPath)) {
      throw new Error("First-frame image file not found.");
    }
  } else if (options.firstFrameAssetId?.trim()) {
    frameDiskPath = getAsset(options.firstFrameAssetId).filePath;
  } else {
    throw new Error("Provide firstFrameAssetId or firstFrameSourcePath for video generation.");
  }
  const extension = frameDiskPath.split(".").pop() || "bin";
  const pathStem =
    options.outputVariant === "solo"
      ? `solo-${options.projectId}`
      : `scene-${options.sceneId}`;
  const copiedFrame = join(outputDir, `${pathStem}-first-frame.${extension}`);
  copyFileSync(frameDiskPath, copiedFrame);
  const key = getKey(mapping.provider, settings);
  const outputPathWithoutExt = join(
    outputDir,
    `${pathStem}-video-${randomUUID()}`,
  );

  if (
    mapping.provider !== "openai" &&
    mapping.provider !== "gemini" &&
    mapping.provider !== "fal"
  ) {
    throw new Error(
      `${mapping.provider} is currently not supported for video generation.`,
    );
  }

  const falCategories =
    mapping.provider === "fal" ? settings.falModelCategories : undefined;
  const available = await listProviderModels(mapping.provider, key);
  const compatible = getCompatibleVideoModelsForProvider(
    mapping.provider,
    available,
    falCategories,
  );
  if (compatible.length === 0) {
    throw new Error(
      `${mapping.provider} has no compatible video models loaded. Validate the provider key and refresh models in Settings.`,
    );
  }
  const trimmed = mapping.model.trim();
  const resolvedModel =
    trimmed && compatible.includes(trimmed) ? trimmed : compatible[0]!;
  let modelUsed = resolvedModel;

  const generated =
    mapping.provider === "openai"
      ? await openAiGenerateVideoFromImage(
          resolvedModel,
          options.prompt,
          copiedFrame,
          key,
          outputPathWithoutExt,
        )
      : mapping.provider === "gemini"
        ? await (async () => {
            const modelCandidates = [
              resolvedModel,
              ...compatible.filter((candidate) => candidate !== resolvedModel),
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
                  outputPathWithoutExt,
                );
              } catch (error) {
                lastError = error;
                if (!isHttp404Error(error)) {
                  throw error;
                }
              }
            }
            throw new Error(
              `Gemini video generation failed for all compatible models: ${modelCandidates.join(", ")}`,
              {
                cause: lastError,
              },
            );
          })()
        : await falGenerateVideoFromImage(
            resolvedModel,
            options.prompt,
            copiedFrame,
            key,
            outputPathWithoutExt,
            options.referenceImagePaths ?? [],
          );

  return {
    provider: mapping.provider,
    model: modelUsed,
    filePath: generated.filePath,
    metadataJson: JSON.stringify({
      prompt: options.prompt,
      firstFrameAssetId: options.firstFrameAssetId ?? null,
      firstFrameSourcePath: options.firstFrameSourcePath?.trim() ?? null,
      references: options.referenceImagePaths ?? [],
      providerMetadata: generated.metadata,
    }),
  };
}

async function elevenLabsGenerateSpeech(
  model: string,
  text: string,
  apiKey: string,
  outputPathWithoutExt: string,
  voiceId: string,
  voiceSettings?: { speed?: number },
): Promise<{ filePath: string; metadata: Record<string, unknown> }> {
  const bytes = await synthesizeElevenLabsAudioBuffer({
    model,
    text,
    apiKey,
    voiceId,
    voiceSettings,
  });
  const filePath = `${outputPathWithoutExt}.mp3`;
  writeFileSync(filePath, bytes);
  return { filePath, metadata: { voiceId, voiceSettings } };
}

function looksLikeElevenLabsModelId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("eleven-") || normalized.startsWith("eleven_");
}

function normalizeElevenLabsVoiceId(
  candidate: string | undefined,
  fallback: string,
): string {
  const raw = candidate?.trim() ?? "";
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
    typeof audio === "object" &&
    "arrayBuffer" in audio &&
    typeof (audio as { arrayBuffer: () => Promise<ArrayBuffer> })
      .arrayBuffer === "function"
  ) {
    const arrayBuffer = await (
      audio as { arrayBuffer: () => Promise<ArrayBuffer> }
    ).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  if (
    audio &&
    typeof audio === "object" &&
    Symbol.asyncIterator in audio &&
    typeof (audio as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
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
  throw new Error("ElevenLabs returned an unsupported audio payload type.");
}

function isInvalidVoiceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid_uid") ||
    normalized.includes("invalid id has been received")
  );
}

async function listElevenLabsVoiceIds(apiKey: string): Promise<string[]> {
  const client = getElevenLabsClient(apiKey) as unknown as {
    voices?: {
      search?: () => Promise<{
        voices?: Array<{ voiceId?: string; voice_id?: string }>;
      }>;
    };
  };
  const res = await client.voices?.search?.();
  const voices = res?.voices ?? [];
  return voices
    .map((voice) => voice.voiceId ?? voice.voice_id ?? "")
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
    ...(options.voiceSettings ? { voiceSettings: options.voiceSettings } : {}),
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
  const defaultVoiceId = "EXAVITQu4vr4xnSDxMaL";
  const primaryVoiceId = normalizeElevenLabsVoiceId(
    options.voiceId,
    defaultVoiceId,
  );
  let resolvedVoiceId = primaryVoiceId;
  try {
    const availableVoiceIds = await listElevenLabsVoiceIds(options.apiKey);
    if (
      availableVoiceIds.length > 0 &&
      !availableVoiceIds.includes(primaryVoiceId)
    ) {
      resolvedVoiceId = availableVoiceIds.includes(defaultVoiceId)
        ? defaultVoiceId
        : availableVoiceIds[0];
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
      voiceSettings: options.voiceSettings,
    });
  } catch (error) {
    if (isInvalidVoiceError(error)) {
      try {
        bytes = await synthesizeElevenLabsAudioBuffer({
          model: options.model,
          text: options.text,
          apiKey: options.apiKey,
          voiceId: defaultVoiceId,
          voiceSettings: options.voiceSettings,
        });
      } catch (defaultError) {
        if (!isInvalidVoiceError(defaultError)) {
          throw new Error(
            `ElevenLabs voice preview failed: ${defaultError instanceof Error ? defaultError.message : String(defaultError)}`,
            { cause: defaultError },
          );
        }
        const availableVoiceIds = await listElevenLabsVoiceIds(options.apiKey);
        const fallbackVoiceId = availableVoiceIds[0];
        if (!fallbackVoiceId) {
          throw new Error(
            `ElevenLabs voice preview failed: ${defaultError instanceof Error ? defaultError.message : String(defaultError)}`,
            { cause: defaultError },
          );
        }
        bytes = await synthesizeElevenLabsAudioBuffer({
          model: options.model,
          text: options.text,
          apiKey: options.apiKey,
          voiceId: fallbackVoiceId,
          voiceSettings: options.voiceSettings,
        });
      }
    } else {
      throw new Error(
        `ElevenLabs voice preview failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}

export async function generateSpeech(options: {
  projectId: string;
  text: string;
  segments?: Array<{ text: string; voiceId?: string }>;
  voiceSettings?: { speed?: number };
}): Promise<{
  provider: ProviderName;
  model: string;
  filePath: string;
  metadataJson: string;
}> {
  const settings = getSettings();
  const mapping = resolveTask("textToSpeech", settings);
  if (mapping.provider !== "elevenlabs") {
    throw new Error(
      `${mapping.provider} is currently not supported for speech generation.`,
    );
  }
  const outputDir = getProjectAssetsDir(options.projectId);
  const outputPathWithoutExt = join(outputDir, `speech-${randomUUID()}`);
  const key = getKey(mapping.provider, settings);
  const defaultVoiceId = normalizeElevenLabsVoiceId(
    settings.elevenLabsVoiceId,
    "EXAVITQu4vr4xnSDxMaL",
  );
  let generated: { filePath: string; metadata: Record<string, unknown> };
  if (options.segments && options.segments.length > 0) {
    const chunks: Buffer[] = [];
    const usedVoiceIds: string[] = [];
    for (const segment of options.segments) {
      const segmentText = segment.text?.trim();
      if (!segmentText) continue;
      const voiceId = normalizeElevenLabsVoiceId(
        segment.voiceId,
        defaultVoiceId,
      );
      const preview = await synthesizeElevenLabsSpeechPreview({
        model: mapping.model,
        text: segmentText,
        apiKey: key,
        voiceId,
        voiceSettings: options.voiceSettings,
      });
      const base64 = preview.replace(/^data:audio\/mpeg;base64,/, "");
      chunks.push(Buffer.from(base64, "base64"));
      usedVoiceIds.push(voiceId);
    }
    if (chunks.length === 0) {
      throw new Error("No transcript content to synthesize.");
    }
    const filePath = `${outputPathWithoutExt}.mp3`;
    writeFileSync(filePath, Buffer.concat(chunks));
    generated = {
      filePath,
      metadata: {
        voiceIds: [...new Set(usedVoiceIds)],
        segmentCount: chunks.length,
      },
    };
  } else {
    generated = await elevenLabsGenerateSpeech(
      mapping.model,
      options.text,
      key,
      outputPathWithoutExt,
      defaultVoiceId,
      options.voiceSettings,
    );
  }

  return {
    provider: mapping.provider,
    model: mapping.model,
    filePath: generated.filePath,
    metadataJson: JSON.stringify({
      textLength: options.text.length,
      providerMetadata: generated.metadata,
    }),
  };
}
