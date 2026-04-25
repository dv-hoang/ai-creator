import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectAssetsDir, getTranscriptsByProject } from './db';
import { secondsToSrtTime } from './utils/srt';

export function buildUntimedTranscript(projectId: string): string {
  const transcripts = getTranscriptsByProject(projectId);
  return transcripts.map((row) => `${row.speaker}: ${row.text}`).join('\n');
}

export function exportSrt(projectId: string): string {
  const transcripts = getTranscriptsByProject(projectId);
  let cursor = 0;

  const blocks = transcripts.map((row, index) => {
    let start = row.startSec;
    let end = row.endSec;

    if (start === 0 && end === 0) {
      start = cursor;
      end = cursor + Math.max(2.5, Math.min(7, row.text.length / 12));
    }

    cursor = end;

    return `${index + 1}\n${secondsToSrtTime(start)} --> ${secondsToSrtTime(end)}\n${row.speaker}: ${row.text}\n`;
  });

  const output = blocks.join('\n');
  const filePath = join(getProjectAssetsDir(projectId), `transcript-${Date.now()}.srt`);
  writeFileSync(filePath, output, 'utf8');
  return filePath;
}
