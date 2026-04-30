import type { FalModelCategories } from "./types";

/**
 * Infer video endpoints from fal `endpoint_id` when API metadata categories
 * were not persisted (legacy settings).
 */
export function heuristicFalLikelyVideoEndpoint(endpointId: string): boolean {
  const s = endpointId.trim().toLowerCase();
  if (!s) {
    return false;
  }
  if (
    /\/tts\/|\bspeech-to-text\b|\bopenrouter\/|\btraining\b|\bwhisper\b|\/chat\/completion/i.test(
      s,
    )
  ) {
    return false;
  }
  return /(image-to-video|text-to-video|video-to-video|reference-to-video|first-last-frame|kling-video|\/veo|seedance|Sora-|sora-|hailuo|happy-horse|wan-[\w-]*image-to-video|grok-imagine-video|ffmpeg-api|motion-control|\bwan-\d+)/i.test(
    s,
  );
}

/** Filter fal endpoints for Generate Image vs Generate Video pickers / validation. */
export function falModelsForGenerationTask(
  task: "generateImage" | "generateVideo",
  models: readonly string[],
  categories?: FalModelCategories,
): string[] {
  return models.filter((id) => {
    const tag = categories?.[id];
    if (task === "generateImage") {
      if (tag === "video") {
        return false;
      }
      if (tag === "image") {
        return true;
      }
      return !heuristicFalLikelyVideoEndpoint(id);
    }
    if (tag === "image") {
      return false;
    }
    if (tag === "video") {
      return true;
    }
    return heuristicFalLikelyVideoEndpoint(id);
  });
}
