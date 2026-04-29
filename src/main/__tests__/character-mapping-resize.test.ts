import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { CHARACTER_IMAGE_MAX_EDGE_PX } from "../providers";

/** Same bounds as `compressCopyImageForCharacterMapping` / library upload in providers. */
async function resizeLikeCharacterPipeline(srcPath: string, destPath: string): Promise<void> {
  await sharp(srcPath)
    .rotate()
    .resize(CHARACTER_IMAGE_MAX_EDGE_PX, CHARACTER_IMAGE_MAX_EDGE_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 6 })
    .toFile(destPath);
}

describe("character map / library resize bounds", () => {
  const dir = mkdtempSync(join(tmpdir(), "ai-creator-resize-"));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fits a very tall image inside the max edge on both dimensions", async () => {
    const tall = join(dir, "tall.png");
    await sharp({
      create: {
        width: 200,
        height: 4000,
        channels: 3,
        background: { r: 10, g: 20, b: 200 },
      },
    })
      .png()
      .toFile(tall);

    const out = join(dir, "tall.webp");
    await resizeLikeCharacterPipeline(tall, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(CHARACTER_IMAGE_MAX_EDGE_PX);
    expect(meta.height).toBeLessThanOrEqual(CHARACTER_IMAGE_MAX_EDGE_PX);
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeGreaterThan(0);
  });

  it("does not upscale a tiny image", async () => {
    const tiny = join(dir, "tiny.png");
    await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 3,
        background: { r: 200, g: 10, b: 10 },
      },
    })
      .png()
      .toFile(tiny);

    const out = join(dir, "tiny.webp");
    await resizeLikeCharacterPipeline(tiny, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(48);
    expect(meta.height).toBe(48);
  });

  it("handles wide panoramas", async () => {
    const wide = join(dir, "wide.png");
    await sharp({
      create: {
        width: 6000,
        height: 400,
        channels: 3,
        background: { r: 40, g: 160, b: 80 },
      },
    })
      .png()
      .toFile(wide);

    const out = join(dir, "wide.webp");
    await resizeLikeCharacterPipeline(wide, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(CHARACTER_IMAGE_MAX_EDGE_PX);
    expect(meta.height).toBeLessThanOrEqual(CHARACTER_IMAGE_MAX_EDGE_PX);
  });
});
