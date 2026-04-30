import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { DeliveryProfile, ProjectInput } from '@shared/types';

function resolveTemplatePath(relativePath: string): string {
  const candidates = [
    join(app.getAppPath(), relativePath),
    join(process.cwd(), relativePath),
  ];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Template not found at expected paths: ${candidates.join(', ')}`);
}

function loadProfileBody(
  profile: DeliveryProfile,
  opts: { enableEndFramePrompts: boolean },
): string {
  const file =
    profile === 'animation_studio'
      ? join('templates', 'profile-studio.md')
      : join('templates', 'profile-short.md');
  let body = readFileSync(resolveTemplatePath(file), 'utf8');
  const endFrameBlock = opts.enableEndFramePrompts
    ? 'When a scene benefits from a controlled final pose (large reposition, transformation, major camera move, hard cut), set `needs_end_frame` to true and provide `end_frame_prompt` as a **static** English image prompt for the ending layout. Otherwise set `needs_end_frame` to false and omit `end_frame_prompt`.'
    : 'Do **not** include `needs_end_frame` or `end_frame_prompt` in the JSON.';
  body = body.replaceAll('{OPTIONAL_END_FRAME_INSTRUCTIONS}', endFrameBlock);
  return body;
}

export function renderAnimationPrompt(
  input: ProjectInput,
  opts?: { enableEndFramePrompts?: boolean },
): string {
  const templatePath = resolveTemplatePath(join('templates', 'animation.md'));
  let template = readFileSync(templatePath, 'utf8');
  const profile = input.deliveryProfile ?? 'short_form';
  const profileBody = loadProfileBody(profile, {
    enableEndFramePrompts: Boolean(opts?.enableEndFramePrompts),
  });

  template = template.replaceAll('{PROFILE_BODY}', profileBody);
  template = template.replaceAll('{STORY_NAME}', input.title);
  template = template.replaceAll('{PROMPT_LANGUAGE}', input.promptLanguage);
  template = template.replaceAll('{ASPECT_RATIO}', input.aspectRatio);
  template = template.replaceAll('{VISUAL_STYLE}', input.visualStyle);
  template = template.replaceAll('{ART_DIRECTION_HINT}', input.artDirectionHint);
  template = template.replaceAll('{TRANSCRIPT_LANGUAGE_POLICY}', input.transcriptLanguagePolicy);
  template = template.replaceAll('{ORIGINAL_CONTENT}', input.originalContent);
  template = template.replaceAll(
    '{DELIVERY_PROFILE}',
    profile === 'animation_studio' ? 'animation_studio' : 'short_form',
  );

  return template;
}

export function stripJsonFence(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : content).trim();
}
