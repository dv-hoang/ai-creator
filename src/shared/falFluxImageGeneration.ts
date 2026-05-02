/**
 * Fal Flux text-to-image models (e.g. flux/schnell) expect prompt-led generation.
 * Attaching scene character images as image_url / reference_* misroutes APIs or implies img2img.
 * `solo` passes user-chosen reference uploads through like `character`.
 */
export function falFluxReferencesForGenerateImage(
  entityType: "character" | "scene" | "solo",
  references: string[] | undefined,
): string[] {
  if (entityType === "scene") {
    return [];
  }
  return references ?? [];
}
