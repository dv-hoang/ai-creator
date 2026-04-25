import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectInput } from '@shared/types';

export function renderAnimationPrompt(input: ProjectInput): string {
  const templatePath = join(process.cwd(), 'templates', 'animation.md');
  let template = readFileSync(templatePath, 'utf8');

  template = template.replaceAll('{STORY_NAME}', input.title);
  template = template.replaceAll('{PROMPT_LANGUAGE}', input.promptLanguage);
  template = template.replaceAll('{ASPECT_RATIO}', input.aspectRatio);
  template = template.replaceAll('{VISUAL_STYLE}', input.visualStyle);
  template = template.replaceAll('{ART_DIRECTION_HINT}', input.artDirectionHint);
  template = template.replaceAll('{TRANSCRIPT_LANGUAGE_POLICY}', input.transcriptLanguagePolicy);
  template = template.replaceAll('{ORIGINAL_CONTENT}', input.originalContent);

  return template;
}

export function stripJsonFence(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : content).trim();
}
