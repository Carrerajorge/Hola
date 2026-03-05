import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

const repoRoot = process.cwd();

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractRoutePathsFromApp(appSource: string): Set<string> {
  const routes = new Set<string>();
  const routeRegex = /<Route\s+path="([^"]+)"/g;
  let match: RegExpExecArray | null = null;
  while ((match = routeRegex.exec(appSource))) {
    routes.add(match[1]);
  }
  return routes;
}

function extractLinkedPaths(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /setLocation\(\s*["'`]([^"'`]+)["'`]/g,
    /window\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source))) {
      found.push(match[1]);
    }
  }
  return found;
}

function normalizePath(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("/")) return "";
  return trimmed.split("?")[0];
}

describe("Routing integrity for critical public flows", () => {
  test("landing/login/signup CTAs point to valid app routes", () => {
    const appSource = readFile("client/src/App.tsx");
    const routePaths = extractRoutePathsFromApp(appSource);

    const sources = [
      readFile("client/src/pages/landing.tsx"),
      readFile("client/src/pages/login.tsx"),
      readFile("client/src/pages/signup.tsx"),
    ];

    const targets = sources.flatMap(extractLinkedPaths).map(normalizePath).filter(Boolean);

    const unknown = targets.filter((target) => {
      if (target === "/") return false; // covered by HOME_ROUTE_REGEX
      if (target.startsWith("/api/")) return false; // backend endpoints are valid external navigations
      return !routePaths.has(target);
    });

    expect(unknown).toEqual([]);
  });
});

