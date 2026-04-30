import type { AppSettings, ProviderName } from './types';

/** Stable fingerprint for comparing API keys without storing plaintext (main + renderer). */
export function providerApiKeyFingerprint(apiKey: string): string {
  const s = apiKey.trim();
  if (!s) return '';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function isProviderValidated(
  settings: AppSettings,
  provider: ProviderName,
): boolean {
  const entry = settings.providerValidation?.[provider];
  if (!entry?.validatedAt || !entry.apiKeyFingerprint) {
    return false;
  }
  const key = settings.providers.find((p) => p.name === provider)?.apiKey?.trim() ?? '';
  if (!key) {
    return false;
  }
  return providerApiKeyFingerprint(key) === entry.apiKeyFingerprint;
}

export function omitProviderValidation(
  map: AppSettings['providerValidation'] | undefined,
  provider: ProviderName,
): AppSettings['providerValidation'] {
  if (!map) {
    return {};
  }
  const rest = { ...map };
  delete rest[provider];
  return rest;
}

/** Drop entries that no longer match the current API key (call before persisting settings). */
export function sanitizeProviderValidation(settings: AppSettings): AppSettings['providerValidation'] {
  const names: ProviderName[] = ['openai', 'gemini', 'fal', 'elevenlabs'];
  const next: NonNullable<AppSettings['providerValidation']> = {
    ...(settings.providerValidation ?? {}),
  };
  for (const p of names) {
    if (!isProviderValidated(settings, p)) {
      delete next[p];
    }
  }
  return next;
}
