import { describe, expect, it } from "vitest";
import { falFluxReferencesForGenerateImage } from "../falFluxImageGeneration";

describe("falFluxReferencesForGenerateImage", () => {
  it("drops references for scenes (text-to-image only)", () => {
    expect(
      falFluxReferencesForGenerateImage("scene", ["/tmp/a.png", "/tmp/b.png"]),
    ).toEqual([]);
  });

  it("keeps references for characters", () => {
    expect(
      falFluxReferencesForGenerateImage("character", ["/tmp/ref.png"]),
    ).toEqual(["/tmp/ref.png"]);
  });

  it("handles undefined references for characters", () => {
    expect(falFluxReferencesForGenerateImage("character", undefined)).toEqual([]);
  });

  it("passes references through for solo mode", () => {
    expect(
      falFluxReferencesForGenerateImage("solo", ["/tmp/ref.png"]),
    ).toEqual(["/tmp/ref.png"]);
  });
});
