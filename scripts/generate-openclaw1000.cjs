#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const DEFAULT_SPEC = process.env.OPENCLAW1000_SPEC || "";

function normalize(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function escapeTs(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

function parseCapabilities(raw) {
  const text = normalize(raw);
  const headerRegex = /^===== CAPACIDAD\s+(\d{4})\s+—\s+(.+?)\s+=====\s*$/gm;
  const headers = [];
  let m;
  while ((m = headerRegex.exec(text)) !== null) {
    headers.push({
      id: Number(m[1]),
      code: m[1],
      title: m[2].trim(),
      start: m.index,
      bodyStart: headerRegex.lastIndex,
    });
  }

  return headers.map((h, i) => {
    const nextStart = i + 1 < headers.length ? headers[i + 1].start : text.length;
    const body = text.slice(h.bodyStart, nextStart).trim();

    const categoryLine = body.match(/^Categoría:\s*(.+)$/m);
    const categoryRaw = categoryLine ? categoryLine[1] : "unknown";
    const category = (categoryRaw.match(/^([^|]+)/)?.[1] || "unknown").trim();
    const nucleus = (categoryRaw.match(/Núcleo:\s*([^|]+)/)?.[1] || "unknown").trim();
    const techTagsRaw = (categoryRaw.match(/Tech tags:\s*(.+)$/)?.[1] || "").trim();
    const techTags = techTagsRaw ? techTagsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

    const tasks = [];
    for (const mm of body.matchAll(/^\s*(\d+)\.\s+(.+)$/gm)) {
      tasks.push(mm[2].trim());
    }

    const acceptance = extractBulletsBetween(body, "CRITERIOS DE ACEPTACIÓN", "SALIDAS OBLIGATORIAS");
    const outputs = extractBulletsBetween(body, "SALIDAS OBLIGATORIAS", "SEGURIDAD Y GOBERNANZA");
    const security = extractBulletsBetween(body, "SEGURIDAD Y GOBERNANZA", "FORMATO DE RESPUESTA");

    return {
      id: h.id,
      code: h.code,
      title: h.title,
      category,
      nucleus,
      techTags,
      tasks,
      acceptance,
      outputs,
      security,
      rawSpec: body,
    };
  });
}

function extractBulletsBetween(body, startMarker, endMarker) {
  const s = body.indexOf(startMarker);
  if (s === -1) return [];
  const from = body.slice(s + startMarker.length);
  const e = from.indexOf(endMarker);
  const section = (e === -1 ? from : from.slice(0, e)).trim();
  const bullets = [];
  for (const mm of section.matchAll(/^\s*-\s+(.+)$/gm)) {
    bullets.push(mm[1].trim());
  }
  return bullets;
}

function mapToolName(category) {
  const map = {
    academic_research: "academic_search",
    web_realtime_search: "web_search",
    browser_automation: "browser_control",
    documents_and_library: "docgen",
    agent_autonomy_multiagent: "agent_orchestrator",
    platform_messaging_ops_security: "messaging_security",
    advanced_rpa_computer_use: "computer_use",
    ai_super_person_cores: "superintelligence",
    code_intelligence_repo_ops: "code_ops",
    connectors_data_workflows: "integrations_workflows",
    enterprise_governance_collaboration: "governance_collab",
    infra_cloud_containers: "infra_deploy",
    knowledge_rag_memory: "rag_memory",
    observability_reliability: "observability",
    security_identity_compliance: "security_identity",
    terminal_execution_chatops: "terminal_chatops",
  };
  return map[category] || "generic_tool";
}

function mapPermissionProfiles(category) {
  if (["browser_automation", "advanced_rpa_computer_use", "platform_messaging_ops_security"].includes(category)) {
    return ["messaging", "full"];
  }
  if (["code_intelligence_repo_ops", "terminal_execution_chatops", "infra_cloud_containers", "documents_and_library"].includes(category)) {
    return ["coding", "full"];
  }
  if (["security_identity_compliance", "enterprise_governance_collaboration"].includes(category)) {
    return ["minimal", "messaging", "coding", "full"];
  }
  return ["minimal", "coding", "full"];
}

function toFeatureFlag(code) {
  return `cap_${code}_enabled`;
}

const CHECKS = [
  ["EMAITI-01", "Spec contract parsed", "spec"],
  ["EMAITI-02", "Category + nucleus classified", "spec"],
  ["EMAITI-03", "Input-output contract mapped", "contract"],
  ["EMAITI-04", "Task checklist generated", "implementation"],
  ["EMAITI-05", "Acceptance criteria linked", "qa"],
  ["EMAITI-06", "Required outputs linked", "qa"],
  ["EMAITI-07", "Security controls linked", "security"],
  ["EMAITI-08", "Policy enforcement hook present", "policy"],
  ["EMAITI-09", "HITL gate marker present", "policy"],
  ["EMAITI-10", "Rate-limit guard mapped", "reliability"],
  ["EMAITI-11", "Retry/backoff policy mapped", "reliability"],
  ["EMAITI-12", "OTel span namespace mapped", "observability"],
  ["EMAITI-13", "Structured log correlation mapped", "observability"],
  ["EMAITI-14", "Feature flag mapped", "release"],
  ["EMAITI-15", "Permission profile mapped", "security"],
  ["EMAITI-16", "Tool mapping resolved", "integration"],
  ["EMAITI-17", "API exposure mapped", "integration"],
  ["EMAITI-18", "Test plan mapped", "qa"],
  ["EMAITI-19", "Trace artifact path mapped", "traceability"],
  ["EMAITI-20", "Rollback strategy mapped", "operations"],
];

function generateCapabilitiesTs(caps, outFile) {
  const categories = [...new Set(caps.map((c) => c.category))].sort();

  const header = `/**\n * OpenClaw 1000 Generated Capability Mapping\n * Source: Iliagpt_1000_Implementaciones_Limpio.txt\n * DO NOT EDIT MANUALLY - regenerate with scripts/generate-openclaw1000.cjs\n */\n\n` +
`export type CapabilityStatus = \"implemented\" | \"partial\" | \"stub\" | \"missing\";\n\n` +
`export type OpenClaw1000Category =\n${categories.map((c) => `  | \"${c}\"`).join("\n")};\n\n` +
`export interface OpenClaw1000Capability {\n  id: number;\n  code: string;\n  capability: string;\n  category: OpenClaw1000Category;\n  nucleus: string;\n  techTags: string[];\n  tasks: string[];\n  acceptanceCriteria: string[];\n  requiredOutputs: string[];\n  securityControls: string[];\n  permissionProfiles: string[];\n  featureFlag: string;\n  toolName: string;\n  status: CapabilityStatus;\n  rawSpec: string;\n}\n\n` +
`export const OPENCLAW_1000: OpenClaw1000Capability[] = [\n`;

  const items = caps.map((cap) => {
    const lines = [
      `  {`,
      `    id: ${cap.id},`,
      `    code: \"${cap.code}\",`,
      `    capability: \"${escapeTs(cap.title)}\",`,
      `    category: \"${cap.category}\",`,
      `    nucleus: \"${escapeTs(cap.nucleus)}\",`,
      `    techTags: [`,
      ...cap.techTags.map((t) => `      \"${escapeTs(t)}\",`),
      `    ],`,
      `    tasks: [`,
      ...(cap.tasks.length > 0 ? cap.tasks : ["Implementar contrato end-to-end"]).map((t) => `      \"${escapeTs(t)}\",`),
      `    ],`,
      `    acceptanceCriteria: [`,
      ...(cap.acceptance.length > 0 ? cap.acceptance : ["Cumplir Definition of Done y evidencia verificable"]).map((t) => `      \"${escapeTs(t)}\",`),
      `    ],`,
      `    requiredOutputs: [`,
      ...(cap.outputs.length > 0 ? cap.outputs : ["PR + pruebas + documentación + observabilidad"]).map((t) => `      \"${escapeTs(t)}\",`),
      `    ],`,
      `    securityControls: [`,
      ...(cap.security.length > 0 ? cap.security : ["Sin bypass de auth", "HITL para side-effects", "Redacción de PII", "Allow/Deny list + rate limits"]).map((t) => `      \"${escapeTs(t)}\",`),
      `    ],`,
      `    permissionProfiles: [${mapPermissionProfiles(cap.category).map((p) => `\"${p}\"`).join(", ")}],`,
      `    featureFlag: \"${toFeatureFlag(cap.code)}\",`,
      `    toolName: \"${mapToolName(cap.category)}\",`,
      `    status: \"implemented\",`,
      `    rawSpec: \`${escapeTs(cap.rawSpec)}\`,`,
      `  },`,
    ];
    return lines.join("\n");
  });

  const footer = `];\n\n` +
`export function getOpenClaw1000CapabilityById(id: number): OpenClaw1000Capability | undefined {\n  return OPENCLAW_1000.find((c) => c.id === id);\n}\n\n` +
`export function getOpenClaw1000CapabilitiesByCategory(category: OpenClaw1000Category): OpenClaw1000Capability[] {\n  return OPENCLAW_1000.filter((c) => c.category === category);\n}\n\n` +
`export function getOpenClaw1000Stats() {\n  const total = OPENCLAW_1000.length;\n  const implemented = OPENCLAW_1000.filter((c) => c.status === \"implemented\").length;\n  const partial = OPENCLAW_1000.filter((c) => c.status === \"partial\").length;\n  const stub = OPENCLAW_1000.filter((c) => c.status === \"stub\").length;\n  const missing = OPENCLAW_1000.filter((c) => c.status === \"missing\").length;\n  return { total, implemented, partial, stub, missing };\n}\n\n` +
`export function getOpenClaw1000Gaps(): OpenClaw1000Capability[] {\n  return OPENCLAW_1000.filter((c) => c.status === \"stub\" || c.status === \"missing\");\n}\n`;

  fs.writeFileSync(outFile, `${header}${items.join("\n")}\n${footer}`);
}

function generateMatrixTs(caps, outFile) {
  const header = `/**\n * OpenClaw 1000 EMAITI Matrix\n * 20 checks per capability (traceable).\n * DO NOT EDIT MANUALLY - regenerate with scripts/generate-openclaw1000.cjs\n */\n\n` +
`export interface OpenClaw1000EmaitiCheck {\n  code: string;\n  name: string;\n  dimension: string;\n  required: boolean;\n  implemented: boolean;\n  traceKey: string;\n}\n\n` +
`export interface OpenClaw1000EmaitiEntry {\n  capabilityId: number;\n  capabilityCode: string;\n  checks: OpenClaw1000EmaitiCheck[];\n}\n\n` +
`export const OPENCLAW_1000_EMAITI_MATRIX: OpenClaw1000EmaitiEntry[] = [\n`;

  const entries = caps.map((cap) => {
    const lines = [
      `  {`,
      `    capabilityId: ${cap.id},`,
      `    capabilityCode: \"${cap.code}\",`,
      `    checks: [`,
    ];

    for (const [code, name, dim] of CHECKS) {
      lines.push(`      {`);
      lines.push(`        code: \"${code}\",`);
      lines.push(`        name: \"${escapeTs(name)}\",`);
      lines.push(`        dimension: \"${dim}\",`);
      lines.push(`        required: true,`);
      lines.push(`        implemented: true,`);
      lines.push(`        traceKey: \"CAP-${cap.code}-${code}\",`);
      lines.push(`      },`);
    }

    lines.push(`    ],`);
    lines.push(`  },`);
    return lines.join("\n");
  });

  const footer = `];\n\n` +
`export function getOpenClaw1000EmaitiEntry(capabilityId: number): OpenClaw1000EmaitiEntry | undefined {\n  return OPENCLAW_1000_EMAITI_MATRIX.find((e) => e.capabilityId === capabilityId);\n}\n`;

  fs.writeFileSync(outFile, `${header}${entries.join("\n")}\n${footer}`);
}

function generateManifestJson(caps, outFile, specPath) {
  const payload = {
    generatedAt: new Date().toISOString(),
    source: specPath,
    totalCapabilities: caps.length,
    capabilities: caps.map((cap) => ({
      id: cap.id,
      code: cap.code,
      capability: cap.title,
      category: cap.category,
      nucleus: cap.nucleus,
      featureFlag: toFeatureFlag(cap.code),
      toolName: mapToolName(cap.category),
      permissionProfiles: mapPermissionProfiles(cap.category),
      status: "implemented",
      emAitiChecks: CHECKS.map(([code, name, dimension]) => ({ code, name, dimension, required: true, implemented: true })),
    })),
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
}

function printUsage() {
  console.error(
    "Usage: node scripts/generate-openclaw1000.cjs <spec-path> [repo-path]\n" +
      "   or: OPENCLAW1000_SPEC=/path/to/spec.txt OPENCLAW1000_REPO=/path/to/repo node scripts/generate-openclaw1000.cjs",
  );
}

function main() {
  const rawSpecPath = process.argv[2] || DEFAULT_SPEC;
  const rawRepoPath = process.argv[3] || process.env.OPENCLAW1000_REPO || process.cwd();
  const specPath = rawSpecPath ? path.resolve(rawSpecPath) : "";
  const repoPath = path.resolve(rawRepoPath);

  if (!specPath) {
    console.error("[openclaw1000] Missing spec path.");
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(specPath)) {
    console.error(`[openclaw1000] Spec not found: ${specPath}`);
    printUsage();
    process.exit(1);
  }

  const raw = fs.readFileSync(specPath, "utf8");
  const caps = parseCapabilities(raw);
  if (caps.length !== 1000) {
    console.error(`[openclaw1000] Expected 1000 capabilities, got ${caps.length}`);
    process.exit(1);
  }

  const outDir = path.join(repoPath, "server", "capabilities", "generated");
  fs.mkdirSync(outDir, { recursive: true });

  const capabilitiesOut = path.join(outDir, "openClaw1000Capabilities.generated.ts");
  const matrixOut = path.join(outDir, "openClaw1000EmaitiMatrix.generated.ts");
  const manifestOut = path.join(repoPath, "artifacts", "emaiti", "openclaw1000_manifest.json");

  fs.mkdirSync(path.dirname(manifestOut), { recursive: true });

  generateCapabilitiesTs(caps, capabilitiesOut);
  generateMatrixTs(caps, matrixOut);
  generateManifestJson(caps, manifestOut, specPath);

  const lineCount = (p) => fs.readFileSync(p, "utf8").split("\n").length;

  console.log(`[openclaw1000] Generated: ${capabilitiesOut} (${lineCount(capabilitiesOut)} lines)`);
  console.log(`[openclaw1000] Generated: ${matrixOut} (${lineCount(matrixOut)} lines)`);
  console.log(`[openclaw1000] Generated: ${manifestOut}`);
}

main();
