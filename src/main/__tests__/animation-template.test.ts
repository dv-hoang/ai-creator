import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('templates/animation.md', () => {
  test('includes schema placeholders and delivery profile token', () => {
    const content = readFileSync(join(process.cwd(), 'templates', 'animation.md'), 'utf8');
    expect(content).toContain('PROMPT_LANGUAGE');
    expect(content).toContain('"prompt":');
    expect(content).toContain('"image_prompt":');
    expect(content).toContain('"image_to_video_prompt":');
    expect(content).toContain('{PROFILE_BODY}');
    expect(content).toContain('{DELIVERY_PROFILE}');
  });

  test('enforces transcriptLanguagePolicy for transcript text', () => {
    const content = readFileSync(join(process.cwd(), 'templates', 'animation.md'), 'utf8');
    expect(content).toContain('"transcript"');
    expect(content).toContain('LANGUAGE POLICY');
    expect(content).toContain('{TRANSCRIPT_LANGUAGE_POLICY}');
  });
});

describe('templates/profile bodies', () => {
  test('short profile keeps viral hook blueprint', () => {
    const content = readFileSync(join(process.cwd(), 'templates', 'profile-short.md'), 'utf8');
    expect(content).toContain('Language Rules (CRITICAL)');
    expect(content).toContain('VIRAL HOOK BLUEPRINT');
    expect(content).toContain('{OPTIONAL_END_FRAME_INSTRUCTIONS}');
  });

  test('studio profile omits mandatory viral step 2.5', () => {
    const content = readFileSync(join(process.cwd(), 'templates', 'profile-studio.md'), 'utf8');
    expect(content).toContain('ANIMATION STUDIO PROFILE');
    expect(content).not.toContain('VIRAL HOOK BLUEPRINT');
    expect(content).toContain('{OPTIONAL_END_FRAME_INSTRUCTIONS}');
  });
});

