import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { ProjectInput } from '@shared/types';

function resolveTemplatePath(): string {
  const relativePath = join('templates', 'animation.md');
  const candidates = [
    // Packaged app / dev main process entry point
    join(app.getAppPath(), relativePath),
    // Fallback for development shells launched from project root
    join(process.cwd(), relativePath)
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

export function renderAnimationPrompt(input: ProjectInput): string {
  const templatePath = resolveTemplatePath();
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
