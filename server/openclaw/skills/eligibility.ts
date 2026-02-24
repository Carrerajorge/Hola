// server/openclaw/skills/eligibility.ts
import { execFileSync } from 'child_process';

interface EligibilityRequirements {
  os?: string[];
  binaries?: string[];
  envVars?: string[];
}

interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export function checkSkillEligibility(requirements: EligibilityRequirements): EligibilityResult {
  const reasons: string[] = [];

  // Check OS
  if (requirements.os && requirements.os.length > 0) {
    if (!requirements.os.includes(process.platform)) {
      reasons.push(`OS mismatch: requires ${requirements.os.join('|')}, got ${process.platform}`);
    }
  }

  // Check binaries
  if (requirements.binaries) {
    for (const bin of requirements.binaries) {
      if (!isBinaryAvailable(bin)) {
        reasons.push(`Missing binary: ${bin}`);
      }
    }
  }

  // Check env vars
  if (requirements.envVars) {
    for (const envVar of requirements.envVars) {
      if (!process.env[envVar]) {
        reasons.push(`Missing env var: ${envVar}`);
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

function isBinaryAvailable(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
