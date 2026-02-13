/**
 * Containers & Infrastructure Service
 * Capabilities 601-650: Docker, Kubernetes, Terraform, Cloud provisioning
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============================================
// TYPES
// ============================================

export interface DockerfileConfig {
  language: string;
  framework?: string;
  nodeVersion?: string;
  pythonVersion?: string;
  port?: number;
  multiStage?: boolean;
  alpine?: boolean;
}

export interface DockerComposeService {
  name: string;
  image?: string;
  build?: string;
  ports?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  dependsOn?: string[];
}

export interface DockerfileAnalysis {
  issues: Array<{
    line: number;
    severity: string;
    message: string;
    recommendation: string;
  }>;
  bestPractices: Array<{ rule: string; passed: boolean; detail: string }>;
  estimatedImageSize: string;
  layers: number;
}

export interface ContainerHealth {
  status: string;
  health: string;
  uptime: string;
  ports: string[];
  memory: string;
  cpu: string;
}

export interface ImageScanResult {
  vulnerabilities: Array<{
    id: string;
    severity: string;
    package: string;
    fixedIn: string;
  }>;
  summary: { critical: number; high: number; medium: number; low: number };
  baseImage: string;
  size: string;
}

export interface K8sManifestConfig {
  name: string;
  image: string;
  replicas?: number;
  port?: number;
  env?: Record<string, string>;
  resources?: { cpu: string; memory: string };
  type?: "deployment" | "statefulset" | "daemonset";
}

export interface HelmChartConfig {
  name: string;
  version: string;
  description: string;
  image: string;
  port: number;
  replicas?: number;
  ingress?: boolean;
  ingressHost?: string;
}

export interface K8sIngressConfig {
  name: string;
  host: string;
  serviceName: string;
  servicePort: number;
  tls?: boolean;
  annotations?: Record<string, string>;
}

export interface K8sHPAConfig {
  name: string;
  targetDeployment: string;
  minReplicas: number;
  maxReplicas: number;
  cpuThreshold?: number;
  memoryThreshold?: string;
}

export interface K8sNetworkPolicyConfig {
  name: string;
  namespace: string;
  podSelector: Record<string, string>;
  ingressRules?: Array<{
    from: Record<string, string>[];
    ports: Array<{ port: number; protocol: string }>;
  }>;
  egressRules?: Array<{
    to: Record<string, string>[];
    ports: Array<{ port: number; protocol: string }>;
  }>;
}

export interface K8sRBACConfig {
  name: string;
  namespace: string;
  rules: Array<{
    apiGroups: string[];
    resources: string[];
    verbs: string[];
  }>;
}

export interface K8sPVCConfig {
  name: string;
  storageClass?: string;
  accessModes: string[];
  size: string;
}

export interface TerraformResource {
  type: string;
  name: string;
  config: Record<string, unknown>;
}

export interface TerraformVariable {
  name: string;
  type: string;
  description: string;
  default?: unknown;
}

export interface TerraformOutput {
  name: string;
  value: string;
  description: string;
}

export interface NginxConfig {
  serverName: string;
  upstream?: string;
  port?: number;
  ssl?: boolean;
  locations?: Array<{
    path: string;
    proxy?: string;
    root?: string;
    tryFiles?: string;
  }>;
}

export interface CDNConfig {
  origin: string;
  domains: string[];
  caching?: Record<string, number>;
}

export interface NetworkRequirements {
  services: string[];
  publicFacing: string[];
  databases: string[];
  caching?: string[];
  messaging?: string[];
}

export interface NetworkArchitecture {
  diagram: string;
  subnets: Array<{
    name: string;
    cidr: string;
    type: "public" | "private";
    services: string[];
  }>;
  securityGroups: Array<{
    name: string;
    inbound: string[];
    outbound: string[];
  }>;
  recommendations: string[];
}

export interface InfraCostConfig {
  provider: "aws" | "gcp" | "azure";
  compute: Array<{ type: string; count: number; hours: number }>;
  storage: Array<{ type: string; sizeGB: number }>;
  bandwidth: number;
}

export interface InfraCostEstimate {
  monthly: number;
  breakdown: Array<{ service: string; cost: number }>;
  recommendations: string[];
}

export interface BackupConfig {
  databases: Array<{ name: string; type: string; sizeGB: number }>;
  frequency: "hourly" | "daily" | "weekly";
  retention: number;
  crossRegion?: boolean;
}

export interface BackupStrategy {
  strategy: string;
  cronExpressions: Record<string, string>;
  estimatedStorageGB: number;
  recoveryTimeObjective: string;
  recoveryPointObjective: string;
}

export interface GitOpsConfig {
  tool: "argocd" | "flux";
  repoUrl: string;
  branch: string;
  path: string;
  namespace: string;
}

// ============================================
// HELPERS
// ============================================

function yamlValue(value: unknown): string {
  if (typeof value === "string") {
    if (
      value.includes(":") ||
      value.includes("#") ||
      value.includes("{") ||
      value.includes("}") ||
      value.includes("[") ||
      value.includes("]") ||
      value.includes(",") ||
      value.includes("&") ||
      value.includes("*") ||
      value.includes("?") ||
      value.includes("|") ||
      value.includes("-") ||
      value.includes("<") ||
      value.includes(">") ||
      value.includes("=") ||
      value.includes("!") ||
      value.includes("%") ||
      value.includes("@") ||
      value.includes("'") ||
      value.startsWith(" ") ||
      value.endsWith(" ")
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return `"${String(value)}"`;
}

// ============================================
// 601-605: DOCKER
// ============================================

export async function generateDockerfile(config: DockerfileConfig): Promise<string> {
  const { language, framework, nodeVersion, pythonVersion, port, multiStage, alpine } = config;
  const lang = language.toLowerCase();
  const useAlpine = alpine !== false;

  switch (lang) {
    case "node":
    case "nodejs":
    case "javascript":
    case "typescript": {
      const nv = nodeVersion || "20";
      const baseTag = useAlpine ? `${nv}-alpine` : nv;

      if (multiStage !== false) {
        const lines: string[] = [
          `# Stage 1: Build`,
          `FROM node:${baseTag} AS builder`,
          ``,
          `WORKDIR /app`,
          ``,
          `# Copy package files first for better layer caching`,
          `COPY package*.json ./`,
          ``,
          `# Install all dependencies (including devDependencies for build)`,
          `RUN npm ci`,
          ``,
          `# Copy source code`,
          `COPY . .`,
          ``,
          `# Build the application`,
          `RUN npm run build`,
          ``,
          `# Stage 2: Production`,
          `FROM node:${baseTag} AS production`,
          ``,
          `# Create non-root user`,
          `RUN addgroup -g 1001 appgroup && \\`,
          `    adduser -u 1001 -G appgroup -s /bin/sh -D appuser`,
          ``,
          `WORKDIR /app`,
          ``,
          `# Copy package files and install production deps only`,
          `COPY package*.json ./`,
          `RUN npm ci --omit=dev && npm cache clean --force`,
          ``,
          `# Copy built artifacts from builder stage`,
          `COPY --from=builder /app/dist ./dist`,
          ``,
          `# Switch to non-root user`,
          `USER appuser`,
          ``,
          `# Expose port`,
          `EXPOSE ${port || 3000}`,
          ``,
          `# Health check`,
          `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\`,
          `  CMD wget --no-verbose --tries=1 --spider http://localhost:${port || 3000}/health || exit 1`,
          ``,
          `# Start the application`,
          `CMD ["node", "dist/index.js"]`,
        ];
        return lines.join("\n");
      }

      const lines: string[] = [
        `FROM node:${baseTag}`,
        ``,
        `RUN addgroup -g 1001 appgroup && \\`,
        `    adduser -u 1001 -G appgroup -s /bin/sh -D appuser`,
        ``,
        `WORKDIR /app`,
        ``,
        `COPY package*.json ./`,
        `RUN npm ci --omit=dev && npm cache clean --force`,
        ``,
        `COPY . .`,
        ``,
        `USER appuser`,
        ``,
        `EXPOSE ${port || 3000}`,
        ``,
        `HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\`,
        `  CMD wget --no-verbose --tries=1 --spider http://localhost:${port || 3000}/health || exit 1`,
        ``,
        `CMD ["node", "index.js"]`,
      ];
      return lines.join("\n");
    }

    case "python": {
      const pv = pythonVersion || "3.12";
      const baseTag = useAlpine ? `${pv}-alpine` : `${pv}-slim`;
      const fw = framework?.toLowerCase();
      const appPort = port || 8000;

      if (multiStage !== false) {
        const startCmd =
          fw === "django"
            ? `CMD ["gunicorn", "--bind", "0.0.0.0:${appPort}", "--workers", "4", "config.wsgi:application"]`
            : fw === "flask"
              ? `CMD ["gunicorn", "--bind", "0.0.0.0:${appPort}", "--workers", "4", "app:app"]`
              : `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${appPort}", "--workers", "4"]`;

        const lines: string[] = [
          `# Stage 1: Build dependencies`,
          `FROM python:${baseTag} AS builder`,
          ``,
          `WORKDIR /app`,
          ``,
          `# Install build dependencies`,
          ...(useAlpine
            ? [
                `RUN apk add --no-cache gcc musl-dev libffi-dev`,
              ]
            : [
                `RUN apt-get update && apt-get install -y --no-install-recommends \\`,
                `    gcc libffi-dev && \\`,
                `    rm -rf /var/lib/apt/lists/*`,
              ]),
          ``,
          `# Install Python dependencies`,
          `COPY requirements.txt .`,
          `RUN pip install --no-cache-dir --prefix=/install -r requirements.txt`,
          ``,
          `# Stage 2: Production`,
          `FROM python:${baseTag} AS production`,
          ``,
          `# Create non-root user`,
          ...(useAlpine
            ? [
                `RUN addgroup -g 1001 appgroup && \\`,
                `    adduser -u 1001 -G appgroup -s /bin/sh -D appuser`,
              ]
            : [
                `RUN groupadd -g 1001 appgroup && \\`,
                `    useradd -u 1001 -g appgroup -s /bin/bash -m appuser`,
              ]),
          ``,
          `WORKDIR /app`,
          ``,
          `# Copy installed packages from builder`,
          `COPY --from=builder /install /usr/local`,
          ``,
          `# Copy application code`,
          `COPY . .`,
          ``,
          `# Set environment variables`,
          `ENV PYTHONDONTWRITEBYTECODE=1 \\`,
          `    PYTHONUNBUFFERED=1`,
          ``,
          `USER appuser`,
          ``,
          `EXPOSE ${appPort}`,
          ``,
          `HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\`,
          `  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${appPort}/health')" || exit 1`,
          ``,
          startCmd,
        ];
        return lines.join("\n");
      }

      const startCmd =
        fw === "django"
          ? `CMD ["gunicorn", "--bind", "0.0.0.0:${appPort}", "--workers", "4", "config.wsgi:application"]`
          : fw === "flask"
            ? `CMD ["gunicorn", "--bind", "0.0.0.0:${appPort}", "--workers", "4", "app:app"]`
            : `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${appPort}", "--workers", "4"]`;

      const lines: string[] = [
        `FROM python:${baseTag}`,
        ``,
        `ENV PYTHONDONTWRITEBYTECODE=1 \\`,
        `    PYTHONUNBUFFERED=1`,
        ``,
        ...(useAlpine
          ? [
              `RUN addgroup -g 1001 appgroup && \\`,
              `    adduser -u 1001 -G appgroup -s /bin/sh -D appuser`,
            ]
          : [
              `RUN groupadd -g 1001 appgroup && \\`,
              `    useradd -u 1001 -g appgroup -s /bin/bash -m appuser`,
            ]),
        ``,
        `WORKDIR /app`,
        ``,
        `COPY requirements.txt .`,
        `RUN pip install --no-cache-dir -r requirements.txt`,
        ``,
        `COPY . .`,
        ``,
        `USER appuser`,
        ``,
        `EXPOSE ${appPort}`,
        ``,
        `HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\`,
        `  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${appPort}/health')" || exit 1`,
        ``,
        startCmd,
      ];
      return lines.join("\n");
    }

    case "go":
    case "golang": {
      const appPort = port || 8080;
      const lines: string[] = [
        `# Stage 1: Build`,
        `FROM golang:1.22-alpine AS builder`,
        ``,
        `RUN apk add --no-cache git ca-certificates`,
        ``,
        `WORKDIR /app`,
        ``,
        `# Copy go module files first for caching`,
        `COPY go.mod go.sum ./`,
        `RUN go mod download`,
        ``,
        `# Copy source and build`,
        `COPY . .`,
        `RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /app/server .`,
        ``,
        `# Stage 2: Minimal production image`,
        `FROM scratch`,
        ``,
        `# Copy CA certificates for HTTPS`,
        `COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/`,
        ``,
        `# Copy binary`,
        `COPY --from=builder /app/server /server`,
        ``,
        `EXPOSE ${appPort}`,
        ``,
        `ENTRYPOINT ["/server"]`,
      ];
      return lines.join("\n");
    }

    case "java": {
      const fw = framework?.toLowerCase();
      const appPort = port || 8080;
      const lines: string[] = [
        `# Stage 1: Build`,
        `FROM eclipse-temurin:21-jdk-alpine AS builder`,
        ``,
        `WORKDIR /app`,
        ``,
        ...(fw === "gradle"
          ? [
              `COPY gradle gradle`,
              `COPY gradlew .`,
              `COPY build.gradle* settings.gradle* ./`,
              `RUN ./gradlew dependencies --no-daemon`,
              ``,
              `COPY src src`,
              `RUN ./gradlew bootJar --no-daemon`,
            ]
          : [
              `COPY .mvn .mvn`,
              `COPY mvnw .`,
              `COPY pom.xml .`,
              `RUN ./mvnw dependency:resolve`,
              ``,
              `COPY src src`,
              `RUN ./mvnw package -DskipTests`,
            ]),
        ``,
        `# Stage 2: Production`,
        `FROM eclipse-temurin:21-jre-alpine AS production`,
        ``,
        `RUN addgroup -g 1001 appgroup && \\`,
        `    adduser -u 1001 -G appgroup -s /bin/sh -D appuser`,
        ``,
        `WORKDIR /app`,
        ``,
        ...(fw === "gradle"
          ? [`COPY --from=builder /app/build/libs/*.jar app.jar`]
          : [`COPY --from=builder /app/target/*.jar app.jar`]),
        ``,
        `USER appuser`,
        ``,
        `EXPOSE ${appPort}`,
        ``,
        `HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \\`,
        `  CMD wget --no-verbose --tries=1 --spider http://localhost:${appPort}/actuator/health || exit 1`,
        ``,
        `ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]`,
      ];
      return lines.join("\n");
    }

    case "rust": {
      const appPort = port || 8080;
      const lines: string[] = [
        `# Stage 1: Build`,
        `FROM rust:1.77-alpine AS builder`,
        ``,
        `RUN apk add --no-cache musl-dev`,
        ``,
        `WORKDIR /app`,
        ``,
        `# Cache dependencies`,
        `COPY Cargo.toml Cargo.lock ./`,
        `RUN mkdir src && echo 'fn main() {}' > src/main.rs`,
        `RUN cargo build --release`,
        `RUN rm -rf src`,
        ``,
        `# Build real application`,
        `COPY src src`,
        `RUN touch src/main.rs && cargo build --release`,
        ``,
        `# Stage 2: Minimal production image`,
        `FROM alpine:3.19 AS production`,
        ``,
        `RUN apk add --no-cache ca-certificates && \\`,
        `    addgroup -g 1001 appgroup && \\`,
        `    adduser -u 1001 -G appgroup -s /bin/sh -D appuser`,
        ``,
        `COPY --from=builder /app/target/release/app /usr/local/bin/app`,
        ``,
        `USER appuser`,
        ``,
        `EXPOSE ${appPort}`,
        ``,
        `ENTRYPOINT ["app"]`,
      ];
      return lines.join("\n");
    }

    default: {
      const appPort = port || 8080;
      const lines: string[] = [
        `FROM ubuntu:22.04`,
        ``,
        `RUN apt-get update && apt-get install -y --no-install-recommends \\`,
        `    ca-certificates \\`,
        `    curl \\`,
        `    && rm -rf /var/lib/apt/lists/*`,
        ``,
        `RUN groupadd -g 1001 appgroup && \\`,
        `    useradd -u 1001 -g appgroup -s /bin/bash -m appuser`,
        ``,
        `WORKDIR /app`,
        ``,
        `COPY . .`,
        ``,
        `USER appuser`,
        ``,
        `EXPOSE ${appPort}`,
        ``,
        `CMD ["./start.sh"]`,
      ];
      return lines.join("\n");
    }
  }
}

export async function generateDockerCompose(
  services: DockerComposeService[]
): Promise<string> {
  const lines: string[] = [];
  lines.push(`version: "3.9"`);
  lines.push(``);
  lines.push(`services:`);

  for (const svc of services) {
    lines.push(`  ${svc.name}:`);

    if (svc.image) {
      lines.push(`    image: ${svc.image}`);
    }
    if (svc.build) {
      lines.push(`    build:`);
      lines.push(`      context: ${svc.build}`);
      lines.push(`      dockerfile: Dockerfile`);
    }

    if (svc.ports && svc.ports.length > 0) {
      lines.push(`    ports:`);
      for (const p of svc.ports) {
        lines.push(`      - "${p}"`);
      }
    }

    if (svc.environment && Object.keys(svc.environment).length > 0) {
      lines.push(`    environment:`);
      for (const [key, val] of Object.entries(svc.environment)) {
        lines.push(`      ${key}: ${yamlValue(val)}`);
      }
    }

    if (svc.volumes && svc.volumes.length > 0) {
      lines.push(`    volumes:`);
      for (const v of svc.volumes) {
        lines.push(`      - ${v}`);
      }
    }

    if (svc.dependsOn && svc.dependsOn.length > 0) {
      lines.push(`    depends_on:`);
      for (const d of svc.dependsOn) {
        lines.push(`      - ${d}`);
      }
    }

    lines.push(`    restart: unless-stopped`);
    lines.push(``);
  }

  // Collect named volumes
  const namedVolumes: string[] = [];
  for (const svc of services) {
    if (svc.volumes) {
      for (const v of svc.volumes) {
        const volumeName = v.split(":")[0];
        if (volumeName && !volumeName.startsWith(".") && !volumeName.startsWith("/")) {
          if (!namedVolumes.includes(volumeName)) {
            namedVolumes.push(volumeName);
          }
        }
      }
    }
  }

  if (namedVolumes.length > 0) {
    lines.push(`volumes:`);
    for (const vol of namedVolumes) {
      lines.push(`  ${vol}:`);
    }
  }

  return lines.join("\n");
}

export async function analyzeDockerfile(dockerfile: string): Promise<DockerfileAnalysis> {
  const lines = dockerfile.split("\n");
  const issues: DockerfileAnalysis["issues"] = [];
  const bestPractices: DockerfileAnalysis["bestPractices"] = [];
  let layerCount = 0;
  let estimatedSizeMB = 100; // base estimate

  let hasNonRootUser = false;
  let hasHealthcheck = false;
  let hasDockerignoreHint = false;
  let hasMultiStage = false;
  let hasPinnedVersions = true;
  let hasWorkdir = false;
  let fromCount = 0;
  let runCount = 0;
  let copyCount = 0;
  let addCount = 0;
  let lastFromLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    if (!line || line.startsWith("#")) continue;

    const instruction = line.split(/\s+/)[0].toUpperCase();

    switch (instruction) {
      case "FROM":
        fromCount++;
        lastFromLine = lineNum;
        layerCount++;

        if (line.includes(":latest") || (!line.includes(":") && !line.includes(" AS "))) {
          hasPinnedVersions = false;
          issues.push({
            line: lineNum,
            severity: "warning",
            message: "Base image tag is not pinned",
            recommendation:
              "Pin the base image to a specific version (e.g., node:20.11-alpine) for reproducible builds",
          });
        }

        if (fromCount > 1) {
          hasMultiStage = true;
        }

        // Estimate base image size
        if (line.includes("alpine")) {
          estimatedSizeMB += 5;
        } else if (line.includes("slim")) {
          estimatedSizeMB += 80;
        } else if (line.includes("scratch")) {
          estimatedSizeMB += 0;
        } else {
          estimatedSizeMB += 200;
        }
        break;

      case "RUN":
        runCount++;
        layerCount++;

        if (line.includes("apt-get install") && !line.includes("--no-install-recommends")) {
          issues.push({
            line: lineNum,
            severity: "warning",
            message: "apt-get install without --no-install-recommends",
            recommendation:
              "Add --no-install-recommends to reduce image size by avoiding unnecessary packages",
          });
          estimatedSizeMB += 50;
        }

        if (line.includes("apt-get install") && !line.includes("rm -rf /var/lib/apt/lists")) {
          // Check if the rm is on a continuation line
          let hasCleanup = false;
          for (let j = i; j < lines.length && j < i + 5; j++) {
            if (lines[j].includes("rm -rf /var/lib/apt/lists")) {
              hasCleanup = true;
              break;
            }
            if (!lines[j].trim().endsWith("\\")) break;
          }
          if (!hasCleanup) {
            issues.push({
              line: lineNum,
              severity: "warning",
              message: "apt-get cache not cleaned in the same layer",
              recommendation:
                'Add "&& rm -rf /var/lib/apt/lists/*" at the end of the RUN instruction to reduce layer size',
            });
            estimatedSizeMB += 30;
          }
        }

        if (line.includes("pip install") && !line.includes("--no-cache-dir")) {
          issues.push({
            line: lineNum,
            severity: "info",
            message: "pip install without --no-cache-dir",
            recommendation: "Add --no-cache-dir to reduce image size",
          });
          estimatedSizeMB += 20;
        }

        if (line.includes("npm install") && !line.includes("npm ci")) {
          issues.push({
            line: lineNum,
            severity: "warning",
            message: "Using npm install instead of npm ci",
            recommendation:
              "Use npm ci for reproducible, faster builds in Docker (respects package-lock.json exactly)",
          });
        }

        estimatedSizeMB += 10;
        break;

      case "COPY":
        copyCount++;
        layerCount++;

        if (line === "COPY . ." && runCount === 0 && copyCount === 1) {
          issues.push({
            line: lineNum,
            severity: "warning",
            message: "Copying all files before installing dependencies",
            recommendation:
              "Copy dependency manifests (package.json, requirements.txt) first, install dependencies, then copy source code for better layer caching",
          });
        }
        break;

      case "ADD":
        addCount++;
        layerCount++;
        if (!line.includes(".tar") && !line.includes("http")) {
          issues.push({
            line: lineNum,
            severity: "info",
            message: "Using ADD instead of COPY",
            recommendation:
              "Prefer COPY over ADD unless you need tar extraction or remote URL fetching",
          });
        }
        break;

      case "USER":
        hasNonRootUser = true;
        break;

      case "HEALTHCHECK":
        hasHealthcheck = true;
        break;

      case "WORKDIR":
        hasWorkdir = true;
        break;

      case "ENV":
        if (line.includes("PASSWORD") || line.includes("SECRET") || line.includes("API_KEY") || line.includes("TOKEN")) {
          issues.push({
            line: lineNum,
            severity: "error",
            message: "Sensitive data may be embedded in image layer via ENV",
            recommendation:
              "Use build args (ARG) for build-time secrets, or mount secrets at runtime. Never bake secrets into ENV.",
          });
        }
        break;

      case "EXPOSE":
        break;

      case "ENTRYPOINT":
      case "CMD":
        if (line.includes("&&") && !line.startsWith("[")) {
          issues.push({
            line: lineNum,
            severity: "info",
            message: "CMD/ENTRYPOINT uses shell form",
            recommendation:
              'Prefer exec form (JSON array) for proper signal handling: CMD ["executable", "param1"]',
          });
        }
        break;
    }
  }

  if (!hasNonRootUser) {
    issues.push({
      line: lastFromLine || 1,
      severity: "error",
      message: "Container runs as root",
      recommendation:
        "Add a non-root USER instruction. Running as root is a security risk.",
    });
  }

  if (!hasHealthcheck) {
    issues.push({
      line: lastFromLine || 1,
      severity: "warning",
      message: "No HEALTHCHECK instruction",
      recommendation:
        "Add HEALTHCHECK for container orchestrators to monitor application health",
    });
  }

  if (!hasWorkdir) {
    issues.push({
      line: 1,
      severity: "info",
      message: "No WORKDIR set",
      recommendation: "Set WORKDIR to avoid relying on the default directory",
    });
  }

  // Best practices summary
  bestPractices.push({
    rule: "Pinned base image versions",
    passed: hasPinnedVersions,
    detail: hasPinnedVersions
      ? "Base images use specific version tags"
      : "One or more FROM instructions use :latest or no tag",
  });

  bestPractices.push({
    rule: "Multi-stage build",
    passed: hasMultiStage,
    detail: hasMultiStage
      ? `Uses ${fromCount} stages for optimized production image`
      : "Single-stage build; consider multi-stage to reduce final image size",
  });

  bestPractices.push({
    rule: "Non-root user",
    passed: hasNonRootUser,
    detail: hasNonRootUser
      ? "Container runs as non-root user"
      : "Container runs as root, which is a security risk",
  });

  bestPractices.push({
    rule: "Health check defined",
    passed: hasHealthcheck,
    detail: hasHealthcheck
      ? "HEALTHCHECK instruction is present"
      : "No HEALTHCHECK instruction found",
  });

  bestPractices.push({
    rule: "Minimal RUN layers",
    passed: runCount <= 3,
    detail:
      runCount <= 3
        ? `${runCount} RUN instruction(s) - good layer efficiency`
        : `${runCount} RUN instructions - consider combining with && to reduce layers`,
  });

  bestPractices.push({
    rule: "No ADD for local files",
    passed: addCount === 0,
    detail:
      addCount === 0
        ? "Uses COPY instead of ADD for local files"
        : "Uses ADD where COPY would suffice",
  });

  bestPractices.push({
    rule: "WORKDIR set",
    passed: hasWorkdir,
    detail: hasWorkdir ? "WORKDIR is explicitly set" : "No WORKDIR instruction found",
  });

  // Adjust estimate for multi-stage
  if (hasMultiStage) {
    estimatedSizeMB = Math.round(estimatedSizeMB * 0.4);
  }

  const sizeStr =
    estimatedSizeMB > 1024
      ? `~${(estimatedSizeMB / 1024).toFixed(1)} GB`
      : `~${estimatedSizeMB} MB`;

  return {
    issues,
    bestPractices,
    estimatedImageSize: sizeStr,
    layers: layerCount,
  };
}

export async function containerHealthCheck(containerName: string): Promise<ContainerHealth> {
  try {
    const { stdout: inspectOut } = await execAsync(
      `docker inspect --format='{{.State.Status}}|{{.State.Health.Status}}|{{.State.StartedAt}}' ${containerName} 2>/dev/null`
    );
    const [status, health, startedAt] = inspectOut.trim().split("|");

    const { stdout: portsOut } = await execAsync(
      `docker port ${containerName} 2>/dev/null`
    );
    const ports = portsOut
      .trim()
      .split("\n")
      .filter((p) => p.length > 0);

    const { stdout: statsOut } = await execAsync(
      `docker stats ${containerName} --no-stream --format='{{.MemUsage}}|{{.CPUPerc}}' 2>/dev/null`
    );
    const [memory, cpu] = statsOut.trim().split("|");

    // Calculate uptime
    const startTime = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - startTime;
    const diffSecs = Math.floor(diffMs / 1000);
    const days = Math.floor(diffSecs / 86400);
    const hours = Math.floor((diffSecs % 86400) / 3600);
    const minutes = Math.floor((diffSecs % 3600) / 60);
    const uptime =
      days > 0
        ? `${days}d ${hours}h ${minutes}m`
        : hours > 0
          ? `${hours}h ${minutes}m`
          : `${minutes}m`;

    return {
      status: status || "unknown",
      health: health || "none",
      uptime,
      ports,
      memory: memory || "N/A",
      cpu: cpu || "N/A",
    };
  } catch {
    return {
      status: "not_found",
      health: "unknown",
      uptime: "N/A",
      ports: [],
      memory: "N/A",
      cpu: "N/A",
    };
  }
}

export async function scanContainerImage(imageName: string): Promise<ImageScanResult> {
  let baseImage = "unknown";
  let size = "unknown";
  const vulnerabilities: ImageScanResult["vulnerabilities"] = [];

  try {
    const { stdout: inspectOut } = await execAsync(
      `docker image inspect ${imageName} --format='{{.Size}}|{{index .RepoTags 0}}' 2>/dev/null`
    );
    const parts = inspectOut.trim().split("|");
    const sizeBytes = parseInt(parts[0], 10);
    if (!isNaN(sizeBytes)) {
      size =
        sizeBytes > 1073741824
          ? `${(sizeBytes / 1073741824).toFixed(1)} GB`
          : `${(sizeBytes / 1048576).toFixed(1)} MB`;
    }
    baseImage = parts[1] || imageName;
  } catch {
    // Image not available locally
  }

  // Attempt to get history for layer analysis
  try {
    const { stdout: historyOut } = await execAsync(
      `docker history ${imageName} --no-trunc --format='{{.CreatedBy}}' 2>/dev/null`
    );
    const historyLines = historyOut.trim().split("\n");

    for (const line of historyLines) {
      // Detect known risky patterns in layers
      if (line.includes("curl") && line.includes("|") && line.includes("sh")) {
        vulnerabilities.push({
          id: "CURL_PIPE_SHELL",
          severity: "high",
          package: "shell",
          fixedIn: "Use package manager or verified downloads with checksum verification",
        });
      }
      if (line.includes(":latest")) {
        vulnerabilities.push({
          id: "UNPINNED_BASE",
          severity: "medium",
          package: "base-image",
          fixedIn: "Pin base image to a specific digest or version tag",
        });
      }
      if (/PASSWORD|SECRET|API_KEY|TOKEN/.test(line) && line.includes("ENV")) {
        vulnerabilities.push({
          id: "SECRET_IN_LAYER",
          severity: "critical",
          package: "env-secrets",
          fixedIn: "Use runtime secrets or Docker secrets instead of ENV for sensitive data",
        });
      }
      if (line.includes("chmod 777")) {
        vulnerabilities.push({
          id: "WIDE_PERMISSIONS",
          severity: "high",
          package: "filesystem",
          fixedIn: "Use least-privilege permissions (e.g., chmod 755 or chmod 644)",
        });
      }
    }
  } catch {
    // Cannot inspect history
  }

  const summary = {
    critical: vulnerabilities.filter((v) => v.severity === "critical").length,
    high: vulnerabilities.filter((v) => v.severity === "high").length,
    medium: vulnerabilities.filter((v) => v.severity === "medium").length,
    low: vulnerabilities.filter((v) => v.severity === "low").length,
  };

  return { vulnerabilities, summary, baseImage, size };
}

// ============================================
// 606-613: KUBERNETES
// ============================================

export function generateK8sManifest(config: K8sManifestConfig): string {
  const {
    name,
    image,
    replicas = 1,
    port = 80,
    env,
    resources,
    type = "deployment",
  } = config;

  const kindMap: Record<string, string> = {
    deployment: "Deployment",
    statefulset: "StatefulSet",
    daemonset: "DaemonSet",
  };
  const kind = kindMap[type] || "Deployment";
  const labels = `app: ${name}`;

  const envSection = env
    ? Object.entries(env)
        .map(([k, v]) => `            - name: ${k}\n              value: ${yamlValue(v)}`)
        .join("\n")
    : null;

  const resourcesSection = resources
    ? [
        `            resources:`,
        `              requests:`,
        `                cpu: ${yamlValue(resources.cpu)}`,
        `                memory: ${yamlValue(resources.memory)}`,
        `              limits:`,
        `                cpu: ${yamlValue(resources.cpu)}`,
        `                memory: ${yamlValue(resources.memory)}`,
      ].join("\n")
    : null;

  const workloadSpec = [
    `apiVersion: apps/v1`,
    `kind: ${kind}`,
    `metadata:`,
    `  name: ${name}`,
    `  labels:`,
    `    ${labels}`,
    `spec:`,
    ...(type !== "daemonset" ? [`  replicas: ${replicas}`] : []),
    `  selector:`,
    `    matchLabels:`,
    `      ${labels}`,
    ...(type === "statefulset" ? [`  serviceName: ${name}`] : []),
    `  template:`,
    `    metadata:`,
    `      labels:`,
    `        ${labels}`,
    `    spec:`,
    `      containers:`,
    `        - name: ${name}`,
    `          image: ${image}`,
    `          ports:`,
    `            - containerPort: ${port}`,
    ...(envSection ? [`          env:`, envSection] : []),
    ...(resourcesSection ? [resourcesSection] : []),
    `          livenessProbe:`,
    `            httpGet:`,
    `              path: /health`,
    `              port: ${port}`,
    `            initialDelaySeconds: 15`,
    `            periodSeconds: 20`,
    `          readinessProbe:`,
    `            httpGet:`,
    `              path: /ready`,
    `              port: ${port}`,
    `            initialDelaySeconds: 5`,
    `            periodSeconds: 10`,
  ].join("\n");

  const serviceSpec = [
    `---`,
    `apiVersion: v1`,
    `kind: Service`,
    `metadata:`,
    `  name: ${name}`,
    `  labels:`,
    `    ${labels}`,
    `spec:`,
    `  selector:`,
    `    ${labels}`,
    `  ports:`,
    `    - protocol: TCP`,
    `      port: ${port}`,
    `      targetPort: ${port}`,
    `  type: ClusterIP`,
  ].join("\n");

  return workloadSpec + "\n" + serviceSpec;
}

export function generateHelmChart(config: HelmChartConfig): {
  chartYaml: string;
  valuesYaml: string;
  deploymentYaml: string;
  serviceYaml: string;
  ingressYaml?: string;
} {
  const {
    name,
    version,
    description,
    image,
    port,
    replicas = 1,
    ingress = false,
    ingressHost,
  } = config;

  const imageParts = image.split(":");
  const imageRepo = imageParts[0];
  const imageTag = imageParts[1] || "latest";

  const chartYaml = [
    `apiVersion: v2`,
    `name: ${name}`,
    `description: ${description}`,
    `type: application`,
    `version: ${version}`,
    `appVersion: "${imageTag}"`,
  ].join("\n");

  const valuesYaml = [
    `replicaCount: ${replicas}`,
    ``,
    `image:`,
    `  repository: ${imageRepo}`,
    `  tag: "${imageTag}"`,
    `  pullPolicy: IfNotPresent`,
    ``,
    `service:`,
    `  type: ClusterIP`,
    `  port: ${port}`,
    ``,
    `ingress:`,
    `  enabled: ${ingress}`,
    ...(ingressHost ? [`  host: ${ingressHost}`] : [`  host: ""`]),
    `  annotations: {}`,
    `  tls: []`,
    ``,
    `resources:`,
    `  limits:`,
    `    cpu: 500m`,
    `    memory: 512Mi`,
    `  requests:`,
    `    cpu: 250m`,
    `    memory: 256Mi`,
    ``,
    `autoscaling:`,
    `  enabled: false`,
    `  minReplicas: 1`,
    `  maxReplicas: 10`,
    `  targetCPUUtilizationPercentage: 80`,
    ``,
    `nodeSelector: {}`,
    `tolerations: []`,
    `affinity: {}`,
  ].join("\n");

  const deploymentYaml = [
    `apiVersion: apps/v1`,
    `kind: Deployment`,
    `metadata:`,
    `  name: {{ include "${name}.fullname" . }}`,
    `  labels:`,
    `    {{- include "${name}.labels" . | nindent 4 }}`,
    `spec:`,
    `  {{- if not .Values.autoscaling.enabled }}`,
    `  replicas: {{ .Values.replicaCount }}`,
    `  {{- end }}`,
    `  selector:`,
    `    matchLabels:`,
    `      {{- include "${name}.selectorLabels" . | nindent 6 }}`,
    `  template:`,
    `    metadata:`,
    `      labels:`,
    `        {{- include "${name}.selectorLabels" . | nindent 8 }}`,
    `    spec:`,
    `      containers:`,
    `        - name: {{ .Chart.Name }}`,
    `          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"`,
    `          imagePullPolicy: {{ .Values.image.pullPolicy }}`,
    `          ports:`,
    `            - name: http`,
    `              containerPort: {{ .Values.service.port }}`,
    `              protocol: TCP`,
    `          livenessProbe:`,
    `            httpGet:`,
    `              path: /health`,
    `              port: http`,
    `            initialDelaySeconds: 15`,
    `            periodSeconds: 20`,
    `          readinessProbe:`,
    `            httpGet:`,
    `              path: /ready`,
    `              port: http`,
    `            initialDelaySeconds: 5`,
    `            periodSeconds: 10`,
    `          resources:`,
    `            {{- toYaml .Values.resources | nindent 12 }}`,
    `      {{- with .Values.nodeSelector }}`,
    `      nodeSelector:`,
    `        {{- toYaml . | nindent 8 }}`,
    `      {{- end }}`,
    `      {{- with .Values.tolerations }}`,
    `      tolerations:`,
    `        {{- toYaml . | nindent 8 }}`,
    `      {{- end }}`,
    `      {{- with .Values.affinity }}`,
    `      affinity:`,
    `        {{- toYaml . | nindent 8 }}`,
    `      {{- end }}`,
  ].join("\n");

  const serviceYaml = [
    `apiVersion: v1`,
    `kind: Service`,
    `metadata:`,
    `  name: {{ include "${name}.fullname" . }}`,
    `  labels:`,
    `    {{- include "${name}.labels" . | nindent 4 }}`,
    `spec:`,
    `  type: {{ .Values.service.type }}`,
    `  ports:`,
    `    - port: {{ .Values.service.port }}`,
    `      targetPort: http`,
    `      protocol: TCP`,
    `      name: http`,
    `  selector:`,
    `    {{- include "${name}.selectorLabels" . | nindent 4 }}`,
  ].join("\n");

  const result: {
    chartYaml: string;
    valuesYaml: string;
    deploymentYaml: string;
    serviceYaml: string;
    ingressYaml?: string;
  } = {
    chartYaml,
    valuesYaml,
    deploymentYaml,
    serviceYaml,
  };

  if (ingress) {
    result.ingressYaml = [
      `{{- if .Values.ingress.enabled -}}`,
      `apiVersion: networking.k8s.io/v1`,
      `kind: Ingress`,
      `metadata:`,
      `  name: {{ include "${name}.fullname" . }}`,
      `  labels:`,
      `    {{- include "${name}.labels" . | nindent 4 }}`,
      `  {{- with .Values.ingress.annotations }}`,
      `  annotations:`,
      `    {{- toYaml . | nindent 4 }}`,
      `  {{- end }}`,
      `spec:`,
      `  {{- if .Values.ingress.tls }}`,
      `  tls:`,
      `    {{- range .Values.ingress.tls }}`,
      `    - hosts:`,
      `        {{- range .hosts }}`,
      `        - {{ . | quote }}`,
      `        {{- end }}`,
      `      secretName: {{ .secretName }}`,
      `    {{- end }}`,
      `  {{- end }}`,
      `  rules:`,
      `    - host: {{ .Values.ingress.host | quote }}`,
      `      http:`,
      `        paths:`,
      `          - path: /`,
      `            pathType: Prefix`,
      `            backend:`,
      `              service:`,
      `                name: {{ include "${name}.fullname" . }}`,
      `                port:`,
      `                  number: {{ .Values.service.port }}`,
      `{{- end }}`,
    ].join("\n");
  }

  return result;
}

export function generateK8sIngress(config: K8sIngressConfig): string {
  const { name, host, serviceName, servicePort, tls = false, annotations = {} } = config;

  const annotationLines = Object.entries(annotations)
    .map(([k, v]) => `    ${k}: ${yamlValue(v)}`)
    .join("\n");

  const lines: string[] = [
    `apiVersion: networking.k8s.io/v1`,
    `kind: Ingress`,
    `metadata:`,
    `  name: ${name}`,
    ...(Object.keys(annotations).length > 0
      ? [`  annotations:`, annotationLines]
      : []),
    `spec:`,
    ...(tls
      ? [
          `  tls:`,
          `    - hosts:`,
          `        - ${host}`,
          `      secretName: ${name}-tls`,
        ]
      : []),
    `  rules:`,
    `    - host: ${host}`,
    `      http:`,
    `        paths:`,
    `          - path: /`,
    `            pathType: Prefix`,
    `            backend:`,
    `              service:`,
    `                name: ${serviceName}`,
    `                port:`,
    `                  number: ${servicePort}`,
  ];

  return lines.join("\n");
}

export function generateK8sHPA(config: K8sHPAConfig): string {
  const {
    name,
    targetDeployment,
    minReplicas,
    maxReplicas,
    cpuThreshold = 80,
    memoryThreshold,
  } = config;

  const metrics: string[] = [
    `    - type: Resource`,
    `      resource:`,
    `        name: cpu`,
    `        target:`,
    `          type: Utilization`,
    `          averageUtilization: ${cpuThreshold}`,
  ];

  if (memoryThreshold) {
    metrics.push(
      `    - type: Resource`,
      `      resource:`,
      `        name: memory`,
      `        target:`,
      `          type: AverageValue`,
      `          averageValue: ${memoryThreshold}`
    );
  }

  const lines: string[] = [
    `apiVersion: autoscaling/v2`,
    `kind: HorizontalPodAutoscaler`,
    `metadata:`,
    `  name: ${name}`,
    `spec:`,
    `  scaleTargetRef:`,
    `    apiVersion: apps/v1`,
    `    kind: Deployment`,
    `    name: ${targetDeployment}`,
    `  minReplicas: ${minReplicas}`,
    `  maxReplicas: ${maxReplicas}`,
    `  metrics:`,
    ...metrics,
    `  behavior:`,
    `    scaleDown:`,
    `      stabilizationWindowSeconds: 300`,
    `      policies:`,
    `        - type: Percent`,
    `          value: 10`,
    `          periodSeconds: 60`,
    `    scaleUp:`,
    `      stabilizationWindowSeconds: 0`,
    `      policies:`,
    `        - type: Percent`,
    `          value: 100`,
    `          periodSeconds: 15`,
    `        - type: Pods`,
    `          value: 4`,
    `          periodSeconds: 15`,
    `      selectPolicy: Max`,
  ];

  return lines.join("\n");
}

export function generateK8sNetworkPolicy(config: K8sNetworkPolicyConfig): string {
  const { name, namespace, podSelector, ingressRules, egressRules } = config;

  const podSelectorLabels = Object.entries(podSelector)
    .map(([k, v]) => `        ${k}: ${yamlValue(v)}`)
    .join("\n");

  const lines: string[] = [
    `apiVersion: networking.k8s.io/v1`,
    `kind: NetworkPolicy`,
    `metadata:`,
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    `spec:`,
    `  podSelector:`,
    `    matchLabels:`,
    podSelectorLabels,
    `  policyTypes:`,
  ];

  if (ingressRules && ingressRules.length > 0) {
    lines.push(`    - Ingress`);
  }
  if (egressRules && egressRules.length > 0) {
    lines.push(`    - Egress`);
  }

  if (ingressRules && ingressRules.length > 0) {
    lines.push(`  ingress:`);
    for (const rule of ingressRules) {
      lines.push(`    - from:`);
      for (const from of rule.from) {
        lines.push(`        - podSelector:`);
        lines.push(`            matchLabels:`);
        for (const [k, v] of Object.entries(from)) {
          lines.push(`              ${k}: ${yamlValue(v)}`);
        }
      }
      if (rule.ports.length > 0) {
        lines.push(`      ports:`);
        for (const p of rule.ports) {
          lines.push(`        - protocol: ${p.protocol}`);
          lines.push(`          port: ${p.port}`);
        }
      }
    }
  }

  if (egressRules && egressRules.length > 0) {
    lines.push(`  egress:`);
    for (const rule of egressRules) {
      lines.push(`    - to:`);
      for (const to of rule.to) {
        lines.push(`        - podSelector:`);
        lines.push(`            matchLabels:`);
        for (const [k, v] of Object.entries(to)) {
          lines.push(`              ${k}: ${yamlValue(v)}`);
        }
      }
      if (rule.ports.length > 0) {
        lines.push(`      ports:`);
        for (const p of rule.ports) {
          lines.push(`        - protocol: ${p.protocol}`);
          lines.push(`          port: ${p.port}`);
        }
      }
    }
  }

  return lines.join("\n");
}

export function generateK8sSecret(
  name: string,
  data: Record<string, string>,
  namespace?: string
): string {
  const encodedData = Object.entries(data)
    .map(([k, v]) => `  ${k}: ${Buffer.from(v).toString("base64")}`)
    .join("\n");

  const lines: string[] = [
    `apiVersion: v1`,
    `kind: Secret`,
    `metadata:`,
    `  name: ${name}`,
    ...(namespace ? [`  namespace: ${namespace}`] : []),
    `type: Opaque`,
    `data:`,
    encodedData,
  ];

  return lines.join("\n");
}

export function generateK8sRBAC(config: K8sRBACConfig): {
  role: string;
  roleBinding: string;
} {
  const { name, namespace, rules } = config;

  const rulesYaml = rules
    .map((rule) => {
      const apiGroups = rule.apiGroups.map((g) => `"${g}"`).join(", ");
      const resources = rule.resources.map((r) => `"${r}"`).join(", ");
      const verbs = rule.verbs.map((v) => `"${v}"`).join(", ");
      return [
        `  - apiGroups: [${apiGroups}]`,
        `    resources: [${resources}]`,
        `    verbs: [${verbs}]`,
      ].join("\n");
    })
    .join("\n");

  const role = [
    `apiVersion: rbac.authorization.k8s.io/v1`,
    `kind: Role`,
    `metadata:`,
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    `rules:`,
    rulesYaml,
  ].join("\n");

  const roleBinding = [
    `apiVersion: rbac.authorization.k8s.io/v1`,
    `kind: RoleBinding`,
    `metadata:`,
    `  name: ${name}-binding`,
    `  namespace: ${namespace}`,
    `subjects:`,
    `  - kind: ServiceAccount`,
    `    name: ${name}`,
    `    namespace: ${namespace}`,
    `roleRef:`,
    `  kind: Role`,
    `  name: ${name}`,
    `  apiGroup: rbac.authorization.k8s.io`,
  ].join("\n");

  return { role, roleBinding };
}

export function generateK8sPVC(config: K8sPVCConfig): string {
  const { name, storageClass, accessModes, size } = config;

  const accessModeLines = accessModes.map((m) => `    - ${m}`).join("\n");

  const lines: string[] = [
    `apiVersion: v1`,
    `kind: PersistentVolumeClaim`,
    `metadata:`,
    `  name: ${name}`,
    `spec:`,
    ...(storageClass ? [`  storageClassName: ${storageClass}`] : []),
    `  accessModes:`,
    accessModeLines,
    `  resources:`,
    `    requests:`,
    `      storage: ${size}`,
  ];

  return lines.join("\n");
}

// ============================================
// 614-616: TERRAFORM
// ============================================

function hclValue(value: unknown, indentLevel: number = 0): string {
  const pad = "  ".repeat(indentLevel);

  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad}  ${hclValue(v, indentLevel + 1)}`).join(",\n");
    return `[\n${items}\n${pad}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const items = entries
      .map(([k, v]) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return `${pad}  ${k} {\n${hclBlock(v as Record<string, unknown>, indentLevel + 2)}\n${pad}  }`;
        }
        return `${pad}  ${k} = ${hclValue(v, indentLevel + 1)}`;
      })
      .join("\n");
    return `{\n${items}\n${pad}}`;
  }
  return `"${String(value)}"`;
}

function hclBlock(obj: Record<string, unknown>, indentLevel: number = 0): string {
  const pad = "  ".repeat(indentLevel);
  return Object.entries(obj)
    .map(([k, v]) => {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        return `${pad}${k} {\n${hclBlock(v as Record<string, unknown>, indentLevel + 1)}\n${pad}}`;
      }
      return `${pad}${k} = ${hclValue(v, indentLevel)}`;
    })
    .join("\n");
}

export function generateTerraformMain(
  provider: string,
  resources: TerraformResource[]
): string {
  const providerLower = provider.toLowerCase();

  const providerBlock = (() => {
    switch (providerLower) {
      case "aws":
        return [
          `terraform {`,
          `  required_version = ">= 1.0"`,
          ``,
          `  required_providers {`,
          `    aws = {`,
          `      source  = "hashicorp/aws"`,
          `      version = "~> 5.0"`,
          `    }`,
          `  }`,
          ``,
          `  backend "s3" {}`,
          `}`,
          ``,
          `provider "aws" {`,
          `  region = var.region`,
          ``,
          `  default_tags {`,
          `    tags = {`,
          `      Environment = var.environment`,
          `      ManagedBy   = "terraform"`,
          `    }`,
          `  }`,
          `}`,
        ].join("\n");

      case "gcp":
      case "google":
        return [
          `terraform {`,
          `  required_version = ">= 1.0"`,
          ``,
          `  required_providers {`,
          `    google = {`,
          `      source  = "hashicorp/google"`,
          `      version = "~> 5.0"`,
          `    }`,
          `  }`,
          ``,
          `  backend "gcs" {}`,
          `}`,
          ``,
          `provider "google" {`,
          `  project = var.project_id`,
          `  region  = var.region`,
          `}`,
        ].join("\n");

      case "azure":
      case "azurerm":
        return [
          `terraform {`,
          `  required_version = ">= 1.0"`,
          ``,
          `  required_providers {`,
          `    azurerm = {`,
          `      source  = "hashicorp/azurerm"`,
          `      version = "~> 3.0"`,
          `    }`,
          `  }`,
          ``,
          `  backend "azurerm" {}`,
          `}`,
          ``,
          `provider "azurerm" {`,
          `  features {}`,
          `}`,
        ].join("\n");

      default:
        return [
          `terraform {`,
          `  required_version = ">= 1.0"`,
          `}`,
          ``,
          `provider "${providerLower}" {}`,
        ].join("\n");
    }
  })();

  const resourceBlocks = resources
    .map((res) => {
      const configLines = hclBlock(res.config, 1);
      return [`resource "${res.type}" "${res.name}" {`, configLines, `}`].join("\n");
    })
    .join("\n\n");

  return `${providerBlock}\n\n${resourceBlocks}\n`;
}

export function generateTerraformVariables(variables: TerraformVariable[]): string {
  const blocks = variables.map((v) => {
    const lines: string[] = [`variable "${v.name}" {`];
    lines.push(`  description = "${v.description}"`);
    lines.push(`  type        = ${v.type}`);
    if (v.default !== undefined) {
      if (typeof v.default === "string") {
        lines.push(`  default     = "${v.default}"`);
      } else if (typeof v.default === "object" && v.default !== null) {
        lines.push(`  default     = ${hclValue(v.default, 1)}`);
      } else {
        lines.push(`  default     = ${v.default}`);
      }
    }
    lines.push(`}`);
    return lines.join("\n");
  });

  return blocks.join("\n\n") + "\n";
}

export function generateTerraformOutputs(outputs: TerraformOutput[]): string {
  const blocks = outputs.map((o) => {
    return [
      `output "${o.name}" {`,
      `  description = "${o.description}"`,
      `  value       = ${o.value}`,
      `}`,
    ].join("\n");
  });

  return blocks.join("\n\n") + "\n";
}

// ============================================
// 617-620: CLOUD & INFRASTRUCTURE
// ============================================

export function generateNginxConfig(config: NginxConfig): string {
  const { serverName, upstream, port = 80, ssl = false, locations = [] } = config;

  const lines: string[] = [];

  if (upstream) {
    lines.push(
      `upstream backend {`,
      `    server ${upstream};`,
      `    keepalive 32;`,
      `}`,
      ``
    );
  }

  // Redirect HTTP to HTTPS if SSL
  if (ssl) {
    lines.push(
      `server {`,
      `    listen 80;`,
      `    listen [::]:80;`,
      `    server_name ${serverName};`,
      ``,
      `    location / {`,
      `        return 301 https://$host$request_uri;`,
      `    }`,
      `}`,
      ``
    );
  }

  lines.push(`server {`);

  if (ssl) {
    lines.push(
      `    listen 443 ssl http2;`,
      `    listen [::]:443 ssl http2;`,
      ``,
      `    ssl_certificate /etc/letsencrypt/live/${serverName}/fullchain.pem;`,
      `    ssl_certificate_key /etc/letsencrypt/live/${serverName}/privkey.pem;`,
      `    ssl_protocols TLSv1.2 TLSv1.3;`,
      `    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;`,
      `    ssl_prefer_server_ciphers off;`,
      `    ssl_session_cache shared:SSL:10m;`,
      `    ssl_session_timeout 1d;`,
      `    ssl_session_tickets off;`,
      ``,
      `    # HSTS`,
      `    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;`
    );
  } else {
    lines.push(`    listen ${port};`, `    listen [::]:${port};`);
  }

  lines.push(
    `    server_name ${serverName};`,
    ``,
    `    # Security headers`,
    `    add_header X-Frame-Options "SAMEORIGIN" always;`,
    `    add_header X-Content-Type-Options "nosniff" always;`,
    `    add_header X-XSS-Protection "1; mode=block" always;`,
    `    add_header Referrer-Policy "strict-origin-when-cross-origin" always;`,
    ``,
    `    # Gzip compression`,
    `    gzip on;`,
    `    gzip_vary on;`,
    `    gzip_proxied any;`,
    `    gzip_comp_level 6;`,
    `    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;`,
    ``
  );

  if (locations.length > 0) {
    for (const loc of locations) {
      lines.push(`    location ${loc.path} {`);
      if (loc.proxy) {
        lines.push(
          `        proxy_pass ${loc.proxy};`,
          `        proxy_http_version 1.1;`,
          `        proxy_set_header Upgrade $http_upgrade;`,
          `        proxy_set_header Connection "upgrade";`,
          `        proxy_set_header Host $host;`,
          `        proxy_set_header X-Real-IP $remote_addr;`,
          `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
          `        proxy_set_header X-Forwarded-Proto $scheme;`,
          `        proxy_cache_bypass $http_upgrade;`,
          `        proxy_read_timeout 86400;`
        );
      }
      if (loc.root) {
        lines.push(`        root ${loc.root};`);
      }
      if (loc.tryFiles) {
        lines.push(`        try_files ${loc.tryFiles};`);
      }
      lines.push(`    }`, ``);
    }
  } else if (upstream) {
    lines.push(
      `    location / {`,
      `        proxy_pass http://backend;`,
      `        proxy_http_version 1.1;`,
      `        proxy_set_header Upgrade $http_upgrade;`,
      `        proxy_set_header Connection "upgrade";`,
      `        proxy_set_header Host $host;`,
      `        proxy_set_header X-Real-IP $remote_addr;`,
      `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      `        proxy_set_header X-Forwarded-Proto $scheme;`,
      `    }`,
      ``
    );
  }

  // Deny access to hidden files
  lines.push(
    `    location ~ /\\. {`,
    `        deny all;`,
    `        access_log off;`,
    `        log_not_found off;`,
    `    }`,
    ``
  );

  lines.push(
    `    access_log /var/log/nginx/${serverName}.access.log;`,
    `    error_log /var/log/nginx/${serverName}.error.log;`,
    `}`
  );

  return lines.join("\n");
}

export function generateSSLConfig(
  domain: string,
  provider: "letsencrypt" | "self-signed" = "letsencrypt"
): string {
  if (provider === "self-signed") {
    return [
      `#!/bin/bash`,
      `# Generate self-signed SSL certificate for ${domain}`,
      `# WARNING: Self-signed certificates should only be used for development/testing`,
      ``,
      `DOMAIN="${domain}"`,
      `CERT_DIR="/etc/ssl/private"`,
      ``,
      `mkdir -p "$CERT_DIR"`,
      ``,
      `# Generate private key`,
      `openssl genrsa -out "$CERT_DIR/$DOMAIN.key" 4096`,
      ``,
      `# Generate CSR`,
      `openssl req -new \\`,
      `  -key "$CERT_DIR/$DOMAIN.key" \\`,
      `  -out "$CERT_DIR/$DOMAIN.csr" \\`,
      `  -subj "/C=US/ST=State/L=City/O=Organization/CN=$DOMAIN"`,
      ``,
      `# Generate self-signed certificate (valid for 365 days)`,
      `openssl x509 -req \\`,
      `  -days 365 \\`,
      `  -in "$CERT_DIR/$DOMAIN.csr" \\`,
      `  -signkey "$CERT_DIR/$DOMAIN.key" \\`,
      `  -out "$CERT_DIR/$DOMAIN.crt" \\`,
      `  -extfile <(printf "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN")`,
      ``,
      `echo "Certificate generated:"`,
      `echo "  Key:  $CERT_DIR/$DOMAIN.key"`,
      `echo "  Cert: $CERT_DIR/$DOMAIN.crt"`,
      ``,
      `# Verify`,
      `openssl x509 -in "$CERT_DIR/$DOMAIN.crt" -text -noout | head -20`,
    ].join("\n");
  }

  // Let's Encrypt with certbot
  return [
    `#!/bin/bash`,
    `# SSL Certificate Setup with Let's Encrypt for ${domain}`,
    `# Prerequisites: certbot installed (apt install certbot python3-certbot-nginx)`,
    ``,
    `DOMAIN="${domain}"`,
    `EMAIL="admin@${domain}"`,
    ``,
    `# Stop nginx temporarily for standalone verification (or use webroot)`,
    `# Option 1: Standalone (requires port 80 free)`,
    `# certbot certonly --standalone -d "$DOMAIN" -d "www.$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive`,
    ``,
    `# Option 2: Nginx plugin (recommended - no downtime)`,
    `certbot --nginx \\`,
    `  -d "$DOMAIN" \\`,
    `  -d "www.$DOMAIN" \\`,
    `  --email "$EMAIL" \\`,
    `  --agree-tos \\`,
    `  --non-interactive \\`,
    `  --redirect \\`,
    `  --staple-ocsp`,
    ``,
    `# Set up auto-renewal`,
    `echo "Testing auto-renewal..."`,
    `certbot renew --dry-run`,
    ``,
    `# Add cron job for auto-renewal (runs twice daily)`,
    `(crontab -l 2>/dev/null; echo "0 0,12 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'") | crontab -`,
    ``,
    `echo "SSL setup complete for $DOMAIN"`,
    `echo "Certificates stored at: /etc/letsencrypt/live/$DOMAIN/"`,
    `echo "Auto-renewal cron job configured."`,
  ].join("\n");
}

export function generateCDNConfig(config: CDNConfig): string {
  const { origin, domains, caching = {} } = config;

  const defaultCaching: Record<string, number> = {
    "text/html": 300,
    "text/css": 86400,
    "application/javascript": 86400,
    "image/*": 2592000,
    "font/*": 2592000,
    ...caching,
  };

  const cachingRules = Object.entries(defaultCaching)
    .map(([contentType, ttl]) => {
      const ttlStr =
        ttl >= 86400
          ? `${Math.round(ttl / 86400)}d`
          : ttl >= 3600
            ? `${Math.round(ttl / 3600)}h`
            : `${ttl}s`;
      return `    ${contentType}: ${ttlStr}`;
    })
    .join("\n");

  const domainList = domains.map((d) => `    - ${d}`).join("\n");

  return [
    `# CDN Configuration`,
    `# Apply this to your CDN provider (CloudFront, Cloudflare, Fastly, etc.)`,
    ``,
    `origin:`,
    `  address: ${origin}`,
    `  protocol: https`,
    `  port: 443`,
    `  timeout_connect: 5s`,
    `  timeout_read: 30s`,
    ``,
    `domains:`,
    domainList,
    ``,
    `caching:`,
    `  default_ttl: 300`,
    `  max_ttl: 2592000`,
    `  rules:`,
    cachingRules,
    ``,
    `compression:`,
    `  enabled: true`,
    `  types:`,
    `    - text/html`,
    `    - text/css`,
    `    - application/javascript`,
    `    - application/json`,
    `    - image/svg+xml`,
    ``,
    `security:`,
    `  waf_enabled: true`,
    `  ddos_protection: true`,
    `  bot_management: true`,
    `  headers:`,
    `    X-Frame-Options: SAMEORIGIN`,
    `    X-Content-Type-Options: nosniff`,
    `    X-XSS-Protection: "1; mode=block"`,
    `    Strict-Transport-Security: "max-age=31536000; includeSubDomains"`,
    `    Content-Security-Policy: "default-src 'self'"`,
    ``,
    `performance:`,
    `  http2: true`,
    `  http3: true`,
    `  early_hints: true`,
    `  image_optimization: true`,
    `  minification:`,
    `    html: true`,
    `    css: true`,
    `    javascript: true`,
    ``,
    `cache_invalidation:`,
    `  purge_all_url: /cdn/purge/all`,
    `  purge_by_tag: true`,
    `  purge_by_prefix: true`,
  ].join("\n");
}

export function designNetworkArchitecture(requirements: NetworkRequirements): NetworkArchitecture {
  const { services, publicFacing, databases, caching = [], messaging = [] } = requirements;

  const allServices = [...services];
  const privateServices = services.filter((s) => !publicFacing.includes(s));

  // Build subnets
  const subnets: NetworkArchitecture["subnets"] = [
    {
      name: "public-subnet-a",
      cidr: "10.0.1.0/24",
      type: "public",
      services: ["load-balancer", "nat-gateway", "bastion"],
    },
    {
      name: "public-subnet-b",
      cidr: "10.0.2.0/24",
      type: "public",
      services: ["load-balancer-standby"],
    },
    {
      name: "app-subnet-a",
      cidr: "10.0.10.0/24",
      type: "private",
      services: publicFacing,
    },
    {
      name: "app-subnet-b",
      cidr: "10.0.11.0/24",
      type: "private",
      services: privateServices,
    },
    {
      name: "data-subnet-a",
      cidr: "10.0.20.0/24",
      type: "private",
      services: [...databases, ...caching],
    },
    {
      name: "data-subnet-b",
      cidr: "10.0.21.0/24",
      type: "private",
      services: [...databases.map((d) => `${d}-replica`), ...messaging],
    },
  ];

  // Build security groups
  const securityGroups: NetworkArchitecture["securityGroups"] = [
    {
      name: "sg-load-balancer",
      inbound: ["0.0.0.0/0:443 (HTTPS)", "0.0.0.0/0:80 (HTTP redirect)"],
      outbound: ["10.0.10.0/24:* (app-subnet-a)", "10.0.11.0/24:* (app-subnet-b)"],
    },
    {
      name: "sg-bastion",
      inbound: ["<admin-ip>/32:22 (SSH)"],
      outbound: ["10.0.0.0/16:22 (VPC internal SSH)"],
    },
    {
      name: "sg-application",
      inbound: [
        "sg-load-balancer:8080 (from LB)",
        "sg-bastion:22 (SSH from bastion)",
      ],
      outbound: [
        "sg-database:5432 (PostgreSQL)",
        "sg-cache:6379 (Redis)",
        ...(messaging.length > 0 ? ["sg-messaging:5672 (AMQP)"] : []),
        "0.0.0.0/0:443 (external APIs via NAT)",
      ],
    },
    {
      name: "sg-database",
      inbound: ["sg-application:5432 (from app)"],
      outbound: ["10.0.20.0/24:5432 (replication)"],
    },
  ];

  if (caching.length > 0) {
    securityGroups.push({
      name: "sg-cache",
      inbound: ["sg-application:6379 (from app)"],
      outbound: [],
    });
  }

  if (messaging.length > 0) {
    securityGroups.push({
      name: "sg-messaging",
      inbound: [
        "sg-application:5672 (AMQP from app)",
        "sg-application:15672 (management UI)",
      ],
      outbound: [],
    });
  }

  // Build ASCII diagram
  const maxServiceLen = Math.max(
    ...allServices.map((s) => s.length),
    ...databases.map((d) => d.length),
    ...caching.map((c) => c.length),
    ...messaging.map((m) => m.length),
    12
  );

  const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));

  const diagramLines: string[] = [
    `+${"=".repeat(70)}+`,
    `|${" ".repeat(25)}INTERNET${" ".repeat(37)}|`,
    `+${"=".repeat(70)}+`,
    `                          |`,
    `                    [Load Balancer]`,
    `                     (public-subnet)`,
    `                          |`,
    `          +${"─".repeat(30)}+${"─".repeat(30)}+`,
    `          |                              |`,
  ];

  // Application tier
  const appServices = publicFacing.length > 0 ? publicFacing : allServices.slice(0, 2);
  const appRow = appServices.map((s) => `[${pad(s, maxServiceLen)}]`).join("  ");
  diagramLines.push(
    `     ${appRow}`,
    `          (app-subnet-a / app-subnet-b)`,
    `          |                              |`,
    `          +${"─".repeat(30)}+${"─".repeat(30)}+`,
    `                          |`
  );

  // Data tier
  const dataServices = [
    ...databases.map((d) => `[${pad(d, maxServiceLen)}]`),
    ...caching.map((c) => `[${pad(c, maxServiceLen)}]`),
    ...messaging.map((m) => `[${pad(m, maxServiceLen)}]`),
  ];
  if (dataServices.length > 0) {
    diagramLines.push(
      `     ${dataServices.join("  ")}`,
      `          (data-subnet-a / data-subnet-b)`
    );
  }

  diagramLines.push(
    ``,
    `+${"=".repeat(70)}+`,
    `|  VPC: 10.0.0.0/16${" ".repeat(51)}|`,
    `+${"=".repeat(70)}+`
  );

  // Recommendations
  const recommendations: string[] = [
    "Deploy across multiple Availability Zones for high availability",
    "Use a NAT Gateway in the public subnet for private subnet internet access",
    "Enable VPC Flow Logs for network monitoring and security auditing",
    "Use a bastion host or AWS Systems Manager Session Manager for SSH access",
    "Implement VPC endpoints for AWS services to avoid public internet traversal",
  ];

  if (databases.length > 0) {
    recommendations.push(
      "Enable encryption at rest for all databases",
      "Set up automated database backups with cross-region replication"
    );
  }
  if (caching.length > 0) {
    recommendations.push(
      "Configure Redis/Memcached cluster mode for horizontal scaling"
    );
  }
  if (publicFacing.length > 2) {
    recommendations.push(
      "Consider an API Gateway or service mesh for managing multiple public services"
    );
  }

  return {
    diagram: diagramLines.join("\n"),
    subnets,
    securityGroups,
    recommendations,
  };
}

// ============================================
// 621-623: COST, BACKUP, GITOPS
// ============================================

// Known approximate pricing (monthly rates in USD) as of early 2026.
// These are rough estimates for cost planning purposes only.
const PRICING: Record<string, Record<string, Record<string, number>>> = {
  aws: {
    compute: {
      "t3.micro": 0.0104,
      "t3.small": 0.0208,
      "t3.medium": 0.0416,
      "t3.large": 0.0832,
      "t3.xlarge": 0.1664,
      "m6i.large": 0.096,
      "m6i.xlarge": 0.192,
      "m6i.2xlarge": 0.384,
      "c6i.large": 0.085,
      "c6i.xlarge": 0.17,
      "r6i.large": 0.126,
      "r6i.xlarge": 0.252,
    },
    storage: {
      gp3: 0.08,
      gp2: 0.1,
      io1: 0.125,
      st1: 0.045,
      sc1: 0.015,
      s3: 0.023,
      "s3-ia": 0.0125,
      glacier: 0.004,
    },
    bandwidth: 0.09,
  },
  gcp: {
    compute: {
      "e2-micro": 0.0084,
      "e2-small": 0.0168,
      "e2-medium": 0.0336,
      "e2-standard-2": 0.0671,
      "e2-standard-4": 0.1342,
      "n2-standard-2": 0.0971,
      "n2-standard-4": 0.1942,
      "n2-standard-8": 0.3883,
      "c2-standard-4": 0.2088,
      "c2-standard-8": 0.4176,
    },
    storage: {
      "pd-standard": 0.04,
      "pd-ssd": 0.17,
      "pd-balanced": 0.1,
      gcs: 0.02,
      "gcs-nearline": 0.01,
      "gcs-coldline": 0.004,
    },
    bandwidth: 0.085,
  },
  azure: {
    compute: {
      B1s: 0.0104,
      B2s: 0.0416,
      "D2s_v3": 0.096,
      "D4s_v3": 0.192,
      "D8s_v3": 0.384,
      "E2s_v3": 0.126,
      "E4s_v3": 0.252,
      "F2s_v2": 0.085,
      "F4s_v2": 0.17,
    },
    storage: {
      "standard-hdd": 0.04,
      "standard-ssd": 0.075,
      "premium-ssd": 0.132,
      blob: 0.0184,
      "blob-cool": 0.01,
      "blob-archive": 0.002,
    },
    bandwidth: 0.087,
  },
};

export async function estimateInfraCost(config: InfraCostConfig): Promise<InfraCostEstimate> {
  const { provider, compute, storage, bandwidth } = config;
  const providerPricing = PRICING[provider] || PRICING.aws;
  const breakdown: InfraCostEstimate["breakdown"] = [];
  const recommendations: string[] = [];
  let total = 0;

  // Compute costs
  for (const instance of compute) {
    const hourlyRate = providerPricing.compute[instance.type] || 0.1;
    const monthlyCost = hourlyRate * instance.hours * instance.count;
    total += monthlyCost;
    breakdown.push({
      service: `Compute: ${instance.count}x ${instance.type} (${instance.hours}h/mo)`,
      cost: Math.round(monthlyCost * 100) / 100,
    });

    // Recommendations for compute
    if (instance.hours >= 720 && instance.count >= 1) {
      recommendations.push(
        `Consider Reserved Instances or Savings Plans for ${instance.type} (up to 72% savings for 1-3 year commitment)`
      );
    }
    if (instance.hours < 200) {
      recommendations.push(
        `${instance.type} instances run <200h/mo - consider spot/preemptible instances (up to 90% savings)`
      );
    }
  }

  // Storage costs
  for (const store of storage) {
    const perGBMonth = providerPricing.storage[store.type] || 0.1;
    const monthlyCost = perGBMonth * store.sizeGB;
    total += monthlyCost;
    breakdown.push({
      service: `Storage: ${store.sizeGB} GB ${store.type}`,
      cost: Math.round(monthlyCost * 100) / 100,
    });

    if (store.sizeGB > 1000) {
      recommendations.push(
        `${store.type} storage exceeds 1TB - review lifecycle policies to move cold data to cheaper tiers`
      );
    }
  }

  // Bandwidth costs
  if (bandwidth > 0) {
    const bwRate = providerPricing.bandwidth || 0.09;
    // First 1GB typically free, next 10TB at standard rate
    const chargeableGB = Math.max(0, bandwidth - 1);
    const bwCost = chargeableGB * bwRate;
    total += bwCost;
    breakdown.push({
      service: `Bandwidth: ${bandwidth} GB egress`,
      cost: Math.round(bwCost * 100) / 100,
    });

    if (bandwidth > 10000) {
      recommendations.push(
        "High bandwidth usage detected - consider a CDN to reduce egress costs and improve latency"
      );
    }
  }

  // General recommendations
  if (total > 500) {
    recommendations.push(
      "Monthly cost exceeds $500 - consider setting up billing alerts and budget monitoring"
    );
  }
  if (total > 2000) {
    recommendations.push(
      "Consider contacting the cloud provider for enterprise pricing or volume discounts"
    );
  }

  return {
    monthly: Math.round(total * 100) / 100,
    breakdown,
    recommendations,
  };
}

export function generateBackupStrategy(config: BackupConfig): BackupStrategy {
  const { databases, frequency, retention, crossRegion = false } = config;

  const cronMap: Record<string, string> = {
    hourly: "0 * * * *",
    daily: "0 2 * * *",
    weekly: "0 2 * * 0",
  };
  const baseCron = cronMap[frequency];

  const cronExpressions: Record<string, string> = {};
  let totalSizeGB = 0;

  for (const db of databases) {
    totalSizeGB += db.sizeGB;

    switch (db.type.toLowerCase()) {
      case "postgresql":
      case "postgres":
        cronExpressions[`${db.name}_full_backup`] = baseCron;
        cronExpressions[`${db.name}_wal_archive`] = "*/5 * * * *";
        break;
      case "mysql":
      case "mariadb":
        cronExpressions[`${db.name}_full_backup`] = baseCron;
        cronExpressions[`${db.name}_binlog_backup`] = "*/10 * * * *";
        break;
      case "mongodb":
      case "mongo":
        cronExpressions[`${db.name}_full_backup`] = baseCron;
        cronExpressions[`${db.name}_oplog_backup`] = "*/5 * * * *";
        break;
      case "redis":
        cronExpressions[`${db.name}_rdb_snapshot`] = baseCron;
        cronExpressions[`${db.name}_aof_backup`] = "0 */6 * * *";
        break;
      default:
        cronExpressions[`${db.name}_backup`] = baseCron;
    }
  }

  // Estimate storage: full backups grow with retention
  const frequencyMultiplier =
    frequency === "hourly" ? 24 : frequency === "daily" ? 1 : 1 / 7;
  const totalBackups = Math.ceil(frequencyMultiplier * retention);
  // Assume incremental backups are ~10% of full, plus full backups weekly
  const fullBackupCount = Math.ceil(retention / 7);
  const incrementalCount = totalBackups - fullBackupCount;
  const estimatedStorageGB =
    Math.round(
      (totalSizeGB * fullBackupCount + totalSizeGB * 0.1 * incrementalCount) *
        (crossRegion ? 2 : 1) *
        100
    ) / 100;

  // RPO and RTO
  const rpoMap: Record<string, string> = {
    hourly: "1 hour (with continuous WAL/binlog archiving: ~5 minutes)",
    daily: "24 hours (with continuous WAL/binlog archiving: ~5 minutes)",
    weekly: "7 days (with daily incremental: ~24 hours)",
  };

  const rtoEstimate =
    totalSizeGB < 50
      ? "15-30 minutes"
      : totalSizeGB < 500
        ? "30 minutes - 2 hours"
        : "2-8 hours";

  const strategyParts: string[] = [
    `Backup Strategy for ${databases.length} database(s)`,
    `${"=".repeat(50)}`,
    ``,
    `Schedule: ${frequency} full backups`,
    `Retention: ${retention} days`,
    `Cross-region replication: ${crossRegion ? "enabled" : "disabled"}`,
    ``,
    `Database-Specific Strategies:`,
  ];

  for (const db of databases) {
    strategyParts.push(``, `  ${db.name} (${db.type}, ${db.sizeGB} GB):`);

    switch (db.type.toLowerCase()) {
      case "postgresql":
      case "postgres":
        strategyParts.push(
          `    - Full backup via pg_dump (${frequency})`,
          `    - Continuous WAL archiving to object storage (every 5 min)`,
          `    - Point-in-Time Recovery (PITR) enabled`,
          `    - Test restore weekly to verify integrity`
        );
        break;
      case "mysql":
      case "mariadb":
        strategyParts.push(
          `    - Full backup via mysqldump/xtrabackup (${frequency})`,
          `    - Binary log backup (every 10 min)`,
          `    - Point-in-Time Recovery via binlog replay`,
          `    - Test restore weekly to verify integrity`
        );
        break;
      case "mongodb":
      case "mongo":
        strategyParts.push(
          `    - Full backup via mongodump (${frequency})`,
          `    - Oplog tailing for continuous backup (every 5 min)`,
          `    - Snapshot-based backups for large datasets`,
          `    - Test restore weekly to verify integrity`
        );
        break;
      case "redis":
        strategyParts.push(
          `    - RDB snapshot (${frequency})`,
          `    - AOF backup (every 6 hours)`,
          `    - Both RDB+AOF for fast recovery with minimal data loss`
        );
        break;
      default:
        strategyParts.push(`    - Full backup (${frequency})`);
    }
  }

  strategyParts.push(
    ``,
    `Storage:`,
    `  Estimated total: ${estimatedStorageGB} GB`,
    `  Recommend: Use object storage with lifecycle policies`,
    `  - Active backups (0-7 days): Standard tier`,
    `  - Recent backups (7-30 days): Infrequent Access tier`,
    `  - Archive backups (30+ days): Glacier/Coldline tier`,
    ``,
    `Recovery Objectives:`,
    `  RPO: ${rpoMap[frequency]}`,
    `  RTO: ${rtoEstimate}`,
    ``,
    `Monitoring:`,
    `  - Alert on backup failure (immediate)`,
    `  - Alert on backup size anomaly (>20% change)`,
    `  - Weekly automated restore test`,
    `  - Monthly disaster recovery drill`
  );

  return {
    strategy: strategyParts.join("\n"),
    cronExpressions,
    estimatedStorageGB,
    recoveryTimeObjective: rtoEstimate,
    recoveryPointObjective: rpoMap[frequency],
  };
}

export function generateGitOpsConfig(config: GitOpsConfig): string {
  const { tool, repoUrl, branch, path: repoPath, namespace } = config;

  if (tool === "argocd") {
    return [
      `apiVersion: argoproj.io/v1alpha1`,
      `kind: Application`,
      `metadata:`,
      `  name: ${namespace}-app`,
      `  namespace: argocd`,
      `  finalizers:`,
      `    - resources-finalizer.argocd.argoproj.io`,
      `spec:`,
      `  project: default`,
      `  source:`,
      `    repoURL: ${repoUrl}`,
      `    targetRevision: ${branch}`,
      `    path: ${repoPath}`,
      `  destination:`,
      `    server: https://kubernetes.default.svc`,
      `    namespace: ${namespace}`,
      `  syncPolicy:`,
      `    automated:`,
      `      prune: true`,
      `      selfHeal: true`,
      `      allowEmpty: false`,
      `    syncOptions:`,
      `      - CreateNamespace=true`,
      `      - PrunePropagationPolicy=foreground`,
      `      - PruneLast=true`,
      `    retry:`,
      `      limit: 5`,
      `      backoff:`,
      `        duration: 5s`,
      `        factor: 2`,
      `        maxDuration: 3m0s`,
      `  ignoreDifferences:`,
      `    - group: apps`,
      `      kind: Deployment`,
      `      jsonPointers:`,
      `        - /spec/replicas`,
    ].join("\n");
  }

  // Flux
  return [
    `---`,
    `apiVersion: source.toolkit.fluxcd.io/v1`,
    `kind: GitRepository`,
    `metadata:`,
    `  name: ${namespace}-repo`,
    `  namespace: flux-system`,
    `spec:`,
    `  interval: 1m0s`,
    `  ref:`,
    `    branch: ${branch}`,
    `  url: ${repoUrl}`,
    `  secretRef:`,
    `    name: ${namespace}-git-credentials`,
    `---`,
    `apiVersion: kustomize.toolkit.fluxcd.io/v1`,
    `kind: Kustomization`,
    `metadata:`,
    `  name: ${namespace}-app`,
    `  namespace: flux-system`,
    `spec:`,
    `  interval: 5m0s`,
    `  path: ./${repoPath}`,
    `  prune: true`,
    `  sourceRef:`,
    `    kind: GitRepository`,
    `    name: ${namespace}-repo`,
    `  targetNamespace: ${namespace}`,
    `  timeout: 2m0s`,
    `  retryInterval: 30s`,
    `  wait: true`,
    `  force: false`,
    `  healthChecks:`,
    `    - apiVersion: apps/v1`,
    `      kind: Deployment`,
    `      name: ${namespace}-app`,
    `      namespace: ${namespace}`,
  ].join("\n");
}
