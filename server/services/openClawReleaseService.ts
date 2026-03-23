import { readFile } from "node:fs/promises";
import { resolveEmbeddedOpenClawPackageJsonPathSync } from "./openClawEmbeddedAssets";

const OPENCLAW_OWNER = "openclaw";
const OPENCLAW_REPO = "openclaw";
const OPENCLAW_RELEASE_REFRESH_MINUTES = 15;

export const DEFAULT_OPENCLAW_RELEASE_TAG = "v2026.3.22";

type GitHubReleasePayload = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  tarball_url?: string | null;
  zipball_url?: string | null;
  published_at?: string | null;
  body?: string | null;
  reactions?: {
    total_count?: number;
  } | null;
};

type OpenClawReleaseInfo = {
  tagName: string;
  name: string;
  htmlUrl: string;
  tarballUrl: string | null;
  zipballUrl: string | null;
  publishedAt: string | null;
  overview: string;
  importantNotes: string[];
  highlights: string[];
  notes: string;
  reactionCount: number;
  isLatest: boolean;
};

function stripMarkdown(value: string): string {
  return value
    .replace(/^#+\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function extractOverview(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((entry) => stripMarkdown(entry))
    .filter(Boolean);
  return paragraphs[0] || "Sin resumen disponible para esta release.";
}

function extractHighlights(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => stripMarkdown(line.replace(/^[-*]\s+/, "")))
    .filter(Boolean)
    .slice(0, 6);
}

function extractImportantNotes(body: string): string[] {
  const candidates = body
    .split(/\r?\n/)
    .map((line) => stripMarkdown(line))
    .filter(Boolean)
    .filter((line) => /important|note|breaking|compat/i.test(line));

  return candidates.slice(0, 3);
}

function toReleaseInfo(
  payload: GitHubReleasePayload,
  isLatest: boolean,
): OpenClawReleaseInfo | null {
  const tagName = payload.tag_name?.trim();
  if (!tagName) {
    return null;
  }

  const notes = (payload.body || "").trim();
  return {
    tagName,
    name: payload.name?.trim() || tagName,
    htmlUrl:
      payload.html_url?.trim() ||
      `https://github.com/${OPENCLAW_OWNER}/${OPENCLAW_REPO}/releases/tag/${tagName}`,
    tarballUrl: payload.tarball_url?.trim() || null,
    zipballUrl: payload.zipball_url?.trim() || null,
    publishedAt: payload.published_at?.trim() || null,
    overview: extractOverview(notes),
    importantNotes: extractImportantNotes(notes),
    highlights: extractHighlights(notes),
    notes,
    reactionCount: payload.reactions?.total_count ?? 0,
    isLatest,
  };
}

async function loadBundledOpenClawVersion(): Promise<string | null> {
  const packageJsonPath = resolveEmbeddedOpenClawPackageJsonPathSync({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
  try {
    if (!packageJsonPath) {
      return null;
    }
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

async function fetchGitHubRelease(
  path: string,
  isLatest: boolean,
): Promise<OpenClawReleaseInfo | null> {
  const response = await fetch(
    `https://api.github.com/repos/${OPENCLAW_OWNER}/${OPENCLAW_REPO}${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "iliagpt-openclaw-release-sync",
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub devolvió ${response.status} al consultar ${path}.`,
    );
  }

  const payload = (await response.json()) as GitHubReleasePayload;
  return toReleaseInfo(payload, isLatest);
}

export async function getOpenClawReleaseSnapshot(tag: string): Promise<{
  requestedTag: string;
  syncedAt: string;
  bundled: {
    version: string | null;
    matchesRequested: boolean;
  };
  requestedRelease: OpenClawReleaseInfo | null;
  latestRelease: OpenClawReleaseInfo | null;
  sync: {
    status: "synced" | "update_available" | "tracking_requested" | "offline";
    summary: string;
    autoRefreshMinutes: number;
    latestMatchesRequested: boolean;
  };
  errors: string[];
}> {
  const requestedTag = tag.trim() || DEFAULT_OPENCLAW_RELEASE_TAG;
  const errors: string[] = [];
  const bundledVersion = await loadBundledOpenClawVersion();

  const [requestedReleaseResult, latestReleaseResult] = await Promise.allSettled([
    fetchGitHubRelease(`/releases/tags/${encodeURIComponent(requestedTag)}`, false),
    fetchGitHubRelease("/releases/latest", true),
  ]);

  const requestedRelease =
    requestedReleaseResult.status === "fulfilled"
      ? requestedReleaseResult.value
      : null;
  if (requestedReleaseResult.status === "rejected") {
    errors.push(requestedReleaseResult.reason?.message || String(requestedReleaseResult.reason));
  }

  const latestRelease =
    latestReleaseResult.status === "fulfilled" ? latestReleaseResult.value : null;
  if (latestReleaseResult.status === "rejected") {
    errors.push(latestReleaseResult.reason?.message || String(latestReleaseResult.reason));
  }

  const bundledMatchesRequested = bundledVersion
    ? requestedTag.replace(/^v/i, "").startsWith(bundledVersion)
    : false;
  const latestMatchesRequested = Boolean(
    requestedRelease &&
      latestRelease &&
      requestedRelease.tagName === latestRelease.tagName,
  );

  let status: "synced" | "update_available" | "tracking_requested" | "offline" =
    "offline";
  let summary =
    "No se pudo sincronizar la release remota de OpenClaw. Se mostrará la referencia local.";

  if (requestedRelease && latestRelease && latestMatchesRequested) {
    status = "synced";
    summary = `OpenClaw ${requestedRelease.tagName} is aligned with the latest release.`;
  } else if (requestedRelease && latestRelease) {
    status = "update_available";
    summary = `OpenClaw ${requestedRelease.tagName} tiene una release más reciente disponible: ${latestRelease.tagName}.`;
  } else if (requestedRelease) {
    status = "tracking_requested";
    summary = `Se está siguiendo la release solicitada ${requestedRelease.tagName}.`;
  }

  return {
    requestedTag,
    syncedAt: new Date().toISOString(),
    bundled: {
      version: bundledVersion,
      matchesRequested: bundledMatchesRequested,
    },
    requestedRelease,
    latestRelease,
    sync: {
      status,
      summary,
      autoRefreshMinutes: OPENCLAW_RELEASE_REFRESH_MINUTES,
      latestMatchesRequested,
    },
    errors,
  };
}
