import { describe, expect, it } from "vitest";
import {
  isProviderValidated,
  providerApiKeyFingerprint,
  sanitizeProviderValidation,
} from "../providerValidation";
import type { AppSettings } from "../types";

describe("providerApiKeyFingerprint", () => {
  it("is stable for the same key", () => {
    expect(providerApiKeyFingerprint("sk-test")).toBe(
      providerApiKeyFingerprint("sk-test"),
    );
  });

  it("differs for different keys", () => {
    expect(providerApiKeyFingerprint("a")).not.toBe(
      providerApiKeyFingerprint("b"),
    );
  });

  it("trims whitespace", () => {
    expect(providerApiKeyFingerprint("  abc  ")).toBe(
      providerApiKeyFingerprint("abc"),
    );
  });
});

describe("isProviderValidated", () => {
  it("is true when fingerprint matches", () => {
    const key = "secret-key";
    const settings: AppSettings = {
      language: "en",
      providers: [{ name: "openai", apiKey: key }],
      elevenLabsVoiceId: "x",
      providerModels: {},
      taskModelMappings: {
        generateScript: { provider: "openai", model: "gpt-5-mini" },
        generateImage: { provider: "openai", model: "gpt-image-1" },
        generateVideo: { provider: "openai", model: "veo-3" },
        textToSpeech: { provider: "elevenlabs", model: "eleven-v3" },
      },
      generationEnabled: { generateImage: true, generateVideo: true },
      enablePromptCalibration: false,
      enableEndFramePrompts: false,
      providerValidation: {
        openai: {
          validatedAt: "2020-01-01T00:00:00.000Z",
          apiKeyFingerprint: providerApiKeyFingerprint(key),
        },
      },
    };
    expect(isProviderValidated(settings, "openai")).toBe(true);
  });

  it("is false when key changed", () => {
    const settings: AppSettings = {
      language: "en",
      providers: [{ name: "openai", apiKey: "new-key" }],
      elevenLabsVoiceId: "x",
      providerModels: {},
      taskModelMappings: {
        generateScript: { provider: "openai", model: "gpt-5-mini" },
        generateImage: { provider: "openai", model: "gpt-image-1" },
        generateVideo: { provider: "openai", model: "veo-3" },
        textToSpeech: { provider: "elevenlabs", model: "eleven-v3" },
      },
      generationEnabled: { generateImage: true, generateVideo: true },
      enablePromptCalibration: false,
      enableEndFramePrompts: false,
      providerValidation: {
        openai: {
          validatedAt: "2020-01-01T00:00:00.000Z",
          apiKeyFingerprint: providerApiKeyFingerprint("old-key"),
        },
      },
    };
    expect(isProviderValidated(settings, "openai")).toBe(false);
  });
});

describe("sanitizeProviderValidation", () => {
  it("removes stale entries", () => {
    const settings: AppSettings = {
      language: "en",
      providers: [{ name: "fal", apiKey: "k2" }],
      elevenLabsVoiceId: "x",
      providerModels: {},
      taskModelMappings: {
        generateScript: { provider: "openai", model: "gpt-5-mini" },
        generateImage: { provider: "fal", model: "fal-ai/flux/schnell" },
        generateVideo: { provider: "openai", model: "veo-3" },
        textToSpeech: { provider: "elevenlabs", model: "eleven-v3" },
      },
      generationEnabled: { generateImage: true, generateVideo: true },
      enablePromptCalibration: false,
      enableEndFramePrompts: false,
      providerValidation: {
        fal: {
          validatedAt: "2020-01-01T00:00:00.000Z",
          apiKeyFingerprint: providerApiKeyFingerprint("k1"),
        },
      },
    };
    const cleaned = sanitizeProviderValidation(settings);
    expect(cleaned.fal).toBeUndefined();
  });
});
