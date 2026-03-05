#!/usr/bin/env tsx
/**
 * CLI script: generate a connector scaffold from an OpenAPI 3.x spec.
 *
 * Usage:
 *   tsx scripts/generate-connector.ts \
 *     --spec=path/to/openapi.json \
 *     --id=stripe \
 *     --name="Stripe" \
 *     [--description="Payment processing"] \
 *     [--category=finance] \
 *     [--auth=api_key] \
 *     [--base-url=https://api.stripe.com] \
 *     [--max-ops=20] \
 *     [--scopes=read,write] \
 *     [--env-vars=STRIPE_API_KEY,STRIPE_WEBHOOK_SECRET]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifestFromOpenApi } from "../server/integrations/kernel/openApiCodegen";

/* ------------------------------------------------------------------ */
/*  Arg parsing                                                        */
/* ------------------------------------------------------------------ */

interface CliArgs {
  spec: string;
  id: string;
  name: string;
  description?: string;
  category?: string;
  auth?: string;
  baseUrl?: string;
  maxOps?: number;
  scopes?: string[];
  envVars?: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();

  for (const arg of argv.slice(2)) {
    const eqIdx = arg.indexOf("=");
    if (arg.startsWith("--") && eqIdx !== -1) {
      const key = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx + 1);
      map.set(key, val);
    } else if (arg.startsWith("--")) {
      // Boolean flag (unused here but handle gracefully)
      map.set(arg.slice(2), "true");
    }
  }

  const spec = map.get("spec");
  const id = map.get("id");
  const name = map.get("name");

  if (!spec || !id || !name) {
    console.error(
      "Usage: tsx scripts/generate-connector.ts --spec=<path> --id=<connectorId> --name=<displayName>",
    );
    console.error("");
    console.error("Required:");
    console.error("  --spec=<path>        Path to OpenAPI 3.x spec (JSON or YAML)");
    console.error("  --id=<connectorId>   Unique connector identifier (snake_case)");
    console.error('  --name=<displayName> Human-readable name (e.g. "Stripe")');
    console.error("");
    console.error("Optional:");
    console.error("  --description=<text>       Connector description");
    console.error("  --category=<cat>           Category (finance, crm, etc.)");
    console.error("  --auth=<type>              Auth type: oauth2, api_key, basic, none");
    console.error("  --base-url=<url>           Override base URL");
    console.error("  --max-ops=<n>              Max operations to generate (default 20)");
    console.error("  --scopes=<s1,s2>           Comma-separated OAuth scopes");
    console.error("  --env-vars=<V1,V2>         Comma-separated required env vars");
    process.exit(1);
  }

  return {
    spec,
    id,
    name,
    description: map.get("description"),
    category: map.get("category"),
    auth: map.get("auth"),
    baseUrl: map.get("base-url"),
    maxOps: map.has("max-ops") ? parseInt(map.get("max-ops")!, 10) : undefined,
    scopes: map.has("scopes") ? map.get("scopes")!.split(",").map((s) => s.trim()) : undefined,
    envVars: map.has("env-vars") ? map.get("env-vars")!.split(",").map((s) => s.trim()) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Spec reader (JSON / YAML)                                          */
/* ------------------------------------------------------------------ */

function readSpec(filePath: string): Record<string, any> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(abs, "utf-8");

  // Try JSON first
  try {
    return JSON.parse(raw);
  } catch {
    // Not JSON — try YAML
  }

  // Try YAML via optional dependency
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require("yaml");
    return yaml.parse(raw);
  } catch {
    // yaml package not available — try js-yaml
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jsYaml = require("js-yaml");
    return jsYaml.load(raw) as Record<string, any>;
  } catch {
    // js-yaml not available either
  }

  console.error(
    "Could not parse spec file. For YAML files, install the 'yaml' or 'js-yaml' package.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/*  Path / method extraction from capabilities                         */
/* ------------------------------------------------------------------ */

/**
 * Attempt to recover the HTTP method and path template for each
 * capability by looking at the original OpenAPI spec paths.
 */
function buildOperationMap(
  spec: Record<string, any>,
): Map<string, { method: string; path: string }> {
  const map = new Map<string, { method: string; path: string }>();
  const methods = ["get", "head", "post", "put", "patch", "delete", "options", "trace"];
  const paths = spec.paths || {};

  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of methods) {
      const op = (pathItem as any)[method];
      if (!op) continue;
      const opId = op.operationId;
      if (opId) {
        // Normalize to snake_case to match how openApiCodegen creates operationIds
        const normalized = opId
          .replace(/[^a-zA-Z0-9]+/g, "_")
          .replace(/([a-z])([A-Z])/g, "$1_$2")
          .toLowerCase()
          .replace(/^_+|_+$/g, "")
          .replace(/_+/g, "_");
        map.set(normalized, { method: method.toUpperCase(), path: pathTemplate });
      }
      // Also store a generated key for fallback matching
      const segments = pathTemplate
        .split("/")
        .filter(Boolean)
        .map((seg: string) => seg.replace(/^\{|\}$/g, "").replace(/[^a-zA-Z0-9]/g, "_"));
      const generatedKey = `${method}_${segments.join("_")}`
        .toLowerCase()
        .replace(/_+/g, "_");
      if (!map.has(generatedKey)) {
        map.set(generatedKey, { method: method.toUpperCase(), path: pathTemplate });
      }
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  File generators                                                    */
/* ------------------------------------------------------------------ */

function generateManifestFile(manifest: Record<string, any>): string {
  const json = JSON.stringify(manifest, null, 2);
  // Replace the JSON with typed TS
  return `import type { ConnectorManifest } from "../../kernel/types";

export const manifest: ConnectorManifest = ${json} as const satisfies ConnectorManifest;
`;
}

function generateHandlerFile(
  manifest: Record<string, any>,
  operationMap: Map<string, { method: string; path: string }>,
): string {
  const caps = (manifest.capabilities || []) as Array<{
    operationId: string;
    name: string;
  }>;
  const baseUrl = manifest.baseUrl || "";

  const switchCases = caps
    .map((cap) => {
      const info = operationMap.get(cap.operationId);
      const method = info?.method || "GET";
      const pathTemplate = info?.path || "/";

      // Build the path interpolation expression
      const pathExpr = pathTemplate.replace(
        /\{([^}]+)\}/g,
        (_: string, param: string) => `\${encodeURIComponent(String(input.${param} ?? ""))}`,
      );

      const needsBody = ["POST", "PUT", "PATCH"].includes(method);

      return `    case "${cap.operationId}": {
      // ${cap.name}
      const url = \`${baseUrl ? baseUrl.replace(/\/$/, "") : "${BASE_URL}"}${pathExpr}\`;
      const resp = await fetch(url, {
        method: "${method}",
        headers: {
          "Content-Type": "application/json",
          "Authorization": \`Bearer \${token}\`,
        },${
          needsBody
            ? `
        body: JSON.stringify(input),`
            : ""
        }
      });
      const data = resp.ok ? await resp.json().catch(() => ({})) : undefined;
      return {
        success: resp.ok,
        data: data ?? undefined,
        error: resp.ok ? undefined : \`HTTP \${resp.status}: \${resp.statusText}\`,
      };
    }`;
    })
    .join("\n\n");

  return `/**
 * Auto-generated connector handler.
 * Each case maps a capability operationId to an HTTP call against the upstream API.
 */

export interface ConnectorOperationResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface HandlerContext {
  token: string;
  baseUrl?: string;
}

const BASE_URL = ${JSON.stringify(baseUrl)};

export async function handleOperation(
  operationId: string,
  input: Record<string, any>,
  context: HandlerContext,
): Promise<ConnectorOperationResult> {
  const token = context.token;

  switch (operationId) {
${switchCases}

    default:
      return {
        success: false,
        error: \`Unknown operation: \${operationId}\`,
      };
  }
}
`;
}

function generateIndexFile(): string {
  return `export { manifest } from "./manifest";
export { handleOperation } from "./handler";
export type { ConnectorOperationResult, HandlerContext } from "./handler";
`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function main() {
  const args = parseArgs(process.argv);

  console.log(`\nReading OpenAPI spec from: ${path.resolve(args.spec)}`);
  const spec = readSpec(args.spec);

  const specVersion = spec.openapi || spec.swagger || "unknown";
  console.log(`  Spec version: ${specVersion}`);
  console.log(`  Title: ${spec.info?.title || "(none)"}`);

  const manifest = generateManifestFromOpenApi(spec, {
    connectorId: args.id,
    displayName: args.name,
    description: args.description,
    category: args.category as any,
    authType: args.auth as any,
    baseUrl: args.baseUrl,
    maxOps: args.maxOps,
    scopes: args.scopes,
    requiredEnvVars: args.envVars,
  });

  // Determine output directory
  const scriptDir =
    typeof import.meta.dirname === "string"
      ? import.meta.dirname
      : path.dirname(fileURLToPath(import.meta.url));

  const projectRoot = path.resolve(scriptDir, "..");
  const outDir = path.join(
    projectRoot,
    "server",
    "integrations",
    "connectors",
    args.id,
  );

  fs.mkdirSync(outDir, { recursive: true });

  // Build operation map for handler generation
  const operationMap = buildOperationMap(spec);

  // Write files
  const manifestPath = path.join(outDir, "manifest.ts");
  const handlerPath = path.join(outDir, "handler.ts");
  const indexPath = path.join(outDir, "index.ts");

  fs.writeFileSync(manifestPath, generateManifestFile(manifest), "utf-8");
  fs.writeFileSync(handlerPath, generateHandlerFile(manifest, operationMap), "utf-8");
  fs.writeFileSync(indexPath, generateIndexFile(), "utf-8");

  // Summary
  const capCount = manifest.capabilities.length;
  const readCount = manifest.capabilities.filter(
    (c: any) => c.dataAccessLevel === "read",
  ).length;
  const writeCount = manifest.capabilities.filter(
    (c: any) => c.dataAccessLevel === "write",
  ).length;
  const adminCount = manifest.capabilities.filter(
    (c: any) => c.dataAccessLevel === "admin",
  ).length;

  console.log(`\nGenerated connector "${args.name}" (${args.id}):`);
  console.log(`  Output directory: ${outDir}`);
  console.log(`  Files created:`);
  console.log(`    - manifest.ts  (${capCount} capabilities)`);
  console.log(`    - handler.ts   (${capCount} operation cases)`);
  console.log(`    - index.ts     (barrel re-exports)`);
  console.log(`  Capability breakdown:`);
  console.log(`    - read:  ${readCount}`);
  console.log(`    - write: ${writeCount}`);
  console.log(`    - admin: ${adminCount}`);
  console.log(`  Auth type: ${manifest.authType}`);
  console.log(`  Base URL:  ${manifest.baseUrl || "(not set)"}`);
  console.log("");
}

main();
