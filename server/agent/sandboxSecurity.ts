import { z } from "zod";

export const SandboxConfigSchema = z.object({
  allowNetwork: z.boolean().default(false),
  allowedHosts: z.array(z.string()).default([]),
  maxMemoryMB: z.number().int().positive().default(512),
  maxCpuPercent: z.number().int().min(1).max(100).default(50),
  maxExecutionTimeMs: z.number().int().positive().default(30000),
  blockedModules: z.array(z.string()).default([
    "child_process",
    "fs",
    "net",
    "dgram",
    "cluster",
    "worker_threads",
    "vm"
  ]),
  allowedModules: z.array(z.string()).default([]),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

const DEFAULT_CONFIG: SandboxConfig = {
  allowNetwork: false,
  allowedHosts: [],
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  maxExecutionTimeMs: 30000,
  blockedModules: ["child_process", "fs", "net", "dgram", "cluster", "worker_threads", "vm"],
  allowedModules: [],
};

export class SandboxSecurityManager {
  private config: SandboxConfig;
  
  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  isModuleAllowed(moduleName: string): boolean {
    if (this.config.blockedModules.includes(moduleName)) {
      console.warn(`[SandboxSecurity] Blocked module: ${moduleName}`);
      return false;
    }
    if (this.config.allowedModules.length > 0 && !this.config.allowedModules.includes(moduleName)) {
      console.warn(`[SandboxSecurity] Module not in allowlist: ${moduleName}`);
      return false;
    }
    return true;
  }
  
  isHostAllowed(host: string): boolean {
    if (!this.config.allowNetwork) {
      console.warn(`[SandboxSecurity] Network access denied (disabled)`);
      return false;
    }
    if (this.config.allowedHosts.length > 0 && !this.config.allowedHosts.includes(host)) {
      console.warn(`[SandboxSecurity] Host not in allowlist: ${host}`);
      return false;
    }
    return true;
  }
  
  getResourceLimits(): { memory: number; cpu: number; time: number } {
    return {
      memory: this.config.maxMemoryMB * 1024 * 1024,
      cpu: this.config.maxCpuPercent,
      time: this.config.maxExecutionTimeMs,
    };
  }
  
  validateConfig(): { valid: boolean; errors: string[] } {
    const result = SandboxConfigSchema.safeParse(this.config);
    if (!result.success) {
      return { valid: false, errors: result.error.errors.map(e => e.message) };
    }
    return { valid: true, errors: [] };
  }
}

export const sandboxSecurity = new SandboxSecurityManager();
