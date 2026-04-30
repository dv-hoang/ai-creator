import { describe, expect, it } from "vitest";
import {
  falModelsForGenerationTask,
  heuristicFalLikelyVideoEndpoint,
} from "../falModelFilters";

describe("heuristicFalLikelyVideoEndpoint", () => {
  it("flags common video slug patterns", () => {
    expect(
      heuristicFalLikelyVideoEndpoint("fal-ai/kling-video/v3/pro/image-to-video"),
    ).toBe(true);
    expect(
      heuristicFalLikelyVideoEndpoint("fal-ai/veo3.1/image-to-video"),
    ).toBe(true);
    expect(heuristicFalLikelyVideoEndpoint("fal-ai/flux/schnell")).toBe(false);
  });

  it("filters by catalog categories when provided", () => {
    const models = ["fal-a/x", "fal-b/y"];
    const cats = {
      "fal-a/x": "image" as const,
      "fal-b/y": "video" as const,
    };
    expect(falModelsForGenerationTask("generateImage", models, cats)).toEqual([
      "fal-a/x",
    ]);
    expect(falModelsForGenerationTask("generateVideo", models, cats)).toEqual([
      "fal-b/y",
    ]);
  });
});
