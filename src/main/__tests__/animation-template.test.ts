import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('templates/animation.md', () => {
  test('enforces promptLanguage for prompt fields', () => {
    const content = readFileSync(join(process.cwd(), 'templates', 'animation.md'), 'utf8');
    expect(content).toContain('Language Rules (CRITICAL)');
    expect(content).toContain('PROMPT_LANGUAGE');
    expect(content).toContain('characters[].prompt');
    expect(content).toContain('scenes[].image_prompt');
    expect(content).toContain('scenes[].image_to_video_prompt');
  });

  test('enforces transcriptLanguagePolicy for transcript text', () => {
    const content = readFileSync(join(process.cwd(), 'templates', 'animation.md'), 'utf8');
    expect(content).toContain('transcript[].text');
    expect(content).toContain('LANGUAGE POLICY');
    expect(content).toContain('{TRANSCRIPT_LANGUAGE_POLICY}');
  });
});

