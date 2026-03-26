#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PUBLIC_RUNTIME_CONTRACT = Object.freeze({
  defaultModelId: "moonshotai/kimi-k2.5",
  publicModel: Object.freeze({
    provider: "openrouter",
    modelId: "moonshotai/kimi-k2.5",
  }),
  publicModelCount: 1,
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeModelEntry(value) {
  const entry = asObject(value);
  return {
    provider: asString(entry?.provider).toLowerCase(),
    modelId: asString(entry?.modelId),
    name: asString(entry?.name),
  };
}

export function validatePublicRuntimeContract(payloads, contract = DEFAULT_PUBLIC_RUNTIME_CONTRACT) {
  const issues = [];

  const modelsRoot = asObject(payloads?.modelsPayload);
  const settingsRoot = asObject(payloads?.settingsPayload);
  const rawModels = Array.isArray(modelsRoot?.models) ? modelsRoot.models : null;
  const publicModels = rawModels ? rawModels.map(normalizeModelEntry) : [];
  const settings = asObject(settingsRoot?.settings);
  const defaultModelId = asString(settings?.default_model);

  if (!rawModels) {
    issues.push("`/api/models/available` no devolvio un arreglo `models`.");
  } else if (publicModels.length !== contract.publicModelCount) {
    issues.push(
      `Se esperaba exactamente ${contract.publicModelCount} modelo publico y llegaron ${publicModels.length}.`,
    );
  }

  const onlyModel = publicModels[0];
  if (!onlyModel) {
    issues.push("No se encontro el modelo publico esperado.");
  } else {
    if (onlyModel.provider !== contract.publicModel.provider) {
      issues.push(
        `El proveedor publico esperado era ${contract.publicModel.provider} y llego ${onlyModel.provider || "<vacio>"}.`,
      );
    }
    if (onlyModel.modelId !== contract.publicModel.modelId) {
      issues.push(
        `El modelId publico esperado era ${contract.publicModel.modelId} y llego ${onlyModel.modelId || "<vacio>"}.`,
      );
    }
  }

  if (!defaultModelId) {
    issues.push("`/api/settings/public` no devolvio `settings.default_model`.");
  } else if (defaultModelId !== contract.defaultModelId) {
    issues.push(
      `El default_model esperado era ${contract.defaultModelId} y llego ${defaultModelId}.`,
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    observed: {
      defaultModelId,
      publicModels,
    },
    contract,
  };
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const raw = await response.text();
    let body;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (error) {
      throw new Error(`${url} devolvio JSON invalido: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new Error(`${url} devolvio HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyPublicRuntimeContractFromBaseUrl(params) {
  const baseUrl = String(params?.baseUrl ?? "").trim();
  const timeoutMs = Number(params?.timeoutMs ?? 5000);
  if (!baseUrl) {
    throw new Error("`--base-url` es obligatorio.");
  }

  const modelsUrl = new URL("/api/models/available", baseUrl).toString();
  const settingsUrl = new URL("/api/settings/public", baseUrl).toString();

  const [modelsPayload, settingsPayload] = await Promise.all([
    fetchJson(modelsUrl, timeoutMs),
    fetchJson(settingsUrl, timeoutMs),
  ]);

  return validatePublicRuntimeContract({ modelsPayload, settingsPayload });
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: "",
    label: "public-runtime-contract",
    timeoutMs: 5000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      parsed.baseUrl = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--label") {
      parsed.label = argv[i + 1] ?? parsed.label;
      i += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(argv[i + 1] ?? parsed.timeoutMs);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/verify-public-runtime-contract.mjs --base-url <url> [--label <name>] [--timeout-ms <ms>]");
      process.exit(0);
    }
    throw new Error(`Argumento no soportado: ${arg}`);
  }

  if (!parsed.baseUrl) {
    throw new Error("Falta `--base-url`.");
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 1) {
    throw new Error("`--timeout-ms` debe ser un entero positivo.");
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyPublicRuntimeContractFromBaseUrl(args);

  if (!result.ok) {
    console.error(`[${args.label}] El contrato publico de runtime fallo.`);
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    console.error(JSON.stringify(result.observed, null, 2));
    process.exit(1);
  }

  const onlyModel = result.observed.publicModels[0];
  console.log(`[${args.label}] Contrato publico de runtime verificado.`);
  console.log(`- default_model: ${result.observed.defaultModelId}`);
  console.log(`- public_model: ${onlyModel.provider}/${onlyModel.modelId}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(
      `[public-runtime-contract] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
