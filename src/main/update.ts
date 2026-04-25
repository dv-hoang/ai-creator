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

const githubApiHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'AI-Creator-Desktop'
} as const;

type ReleasePayload = {
  tag_name?: string;
  name?: string;
  draft?: boolean;
  html_url?: string;
};

function versionFromRelease(release: ReleasePayload): string | null {
  const fromTag = (release.tag_name ?? '').trim();
  if (fromTag) {
    return fromTag;
  }
  const fromName = (release.name ?? '').trim();
  // Ignore human-only titles (e.g. "update flow") with no version-like segment
  if (fromName && /\d/.test(fromName)) {
    return fromName;
  }
  return null;
}

/**
 * GitHub's GET /releases/latest only returns the newest stable (non-draft, non-prerelease)
 * release. Newer prereleases or odd publish ordering can make that miss a higher semver.
 * We scan published releases and pick the greatest version by the same compare logic.
 */
async function resolveNewestRelease(
  normalizedRepo: string
): Promise<{ latestVersion: string; releaseUrl: string }> {
  const listUrl = `https://api.github.com/repos/${normalizedRepo}/releases?per_page=50`;
  const listRes = await fetch(listUrl, { headers: { ...githubApiHeaders } });

  if (listRes.ok) {
    const releases = (await listRes.json()) as ReleasePayload[];
    if (Array.isArray(releases) && releases.length > 0) {
      let best: { latestVersion: string; releaseUrl: string } | null = null;
      for (const release of releases) {
        if (release.draft) {
          continue;
        }
        const version = versionFromRelease(release);
        if (!version) {
          continue;
        }
        const releaseUrl =
          release.html_url ?? `https://github.com/${normalizedRepo}/releases/tag/${encodeURIComponent(version)}`;
        if (!best || compareVersions(version, best.latestVersion) > 0) {
          best = { latestVersion: version, releaseUrl };
        }
      }
      if (best) {
        return best;
      }
    }
  }

  const endpoint = `https://api.github.com/repos/${normalizedRepo}/releases/latest`;
  const response = await fetch(endpoint, { headers: { ...githubApiHeaders } });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub release (${response.status})`);
  }

  const payload = (await response.json()) as ReleasePayload;
  const latestVersion = (payload.tag_name ?? payload.name ?? '').trim();
  if (!latestVersion) {
    throw new Error('Latest GitHub release does not include a version tag');
  }

  return {
    latestVersion,
    releaseUrl: payload.html_url ?? `https://github.com/${normalizedRepo}/releases/latest`
  };
}

export async function checkGithubReleaseUpdate(repo: string): Promise<UpdateCheckResult> {
  const normalizedRepo = repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '');
  if (!normalizedRepo || !normalizedRepo.includes('/')) {
    throw new Error('GitHub repo must be in format owner/repo');
  }

  const { latestVersion, releaseUrl } = await resolveNewestRelease(normalizedRepo);
  const currentVersion = app.getVersion();
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseUrl,
    repo: normalizedRepo
  };
}
