import { app } from 'electron';
import type { UpdateCheckResult } from '@shared/types';

function parseVersion(input: string): { numbers: number[]; pre: string } {
  const sanitized = input.trim().replace(/^v/i, '');
  const [core, pre = ''] = sanitized.split('-', 2);
  const numbers = core
    .split('.')
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));
  return { numbers, pre };
}

function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const maxLength = Math.max(va.numbers.length, vb.numbers.length);
  for (let i = 0; i < maxLength; i += 1) {
    const left = va.numbers[i] ?? 0;
    const right = vb.numbers[i] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }

  if (!va.pre && vb.pre) {
    return 1;
  }
  if (va.pre && !vb.pre) {
    return -1;
  }
  return va.pre.localeCompare(vb.pre);
}

export async function checkGithubReleaseUpdate(repo: string): Promise<UpdateCheckResult> {
  const normalizedRepo = repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '');
  if (!normalizedRepo || !normalizedRepo.includes('/')) {
    throw new Error('GitHub repo must be in format owner/repo');
  }

  const endpoint = `https://api.github.com/repos/${normalizedRepo}/releases/latest`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AI-Creator-Desktop'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub release (${response.status})`);
  }

  const payload = (await response.json()) as {
    tag_name?: string;
    html_url?: string;
    name?: string;
  };
  const latestVersion = (payload.tag_name ?? payload.name ?? '').trim();
  if (!latestVersion) {
    throw new Error('Latest GitHub release does not include a version tag');
  }

  const currentVersion = app.getVersion();
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseUrl: payload.html_url ?? `https://github.com/${normalizedRepo}/releases/latest`,
    repo: normalizedRepo
  };
}
