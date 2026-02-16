type RuntimeSkill = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  status: "available" | "disabled" | "unknown";
};

export interface OpenClawSkillsRuntimeSnapshot {
  runtimeAvailable: boolean;
  source: "remote_runtime" | "fallback";
  fallback: boolean;
  fetchedAt: string;
  skills: RuntimeSkill[];
  message?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

export async function getOpenClawSkillsRuntimeSnapshot(): Promise<OpenClawSkillsRuntimeSnapshot> {
  const endpoint = (process.env.OPENCLAW_SKILLS_RUNTIME_URL || "").trim();
  const fallback = (message: string): OpenClawSkillsRuntimeSnapshot => ({
    runtimeAvailable: false,
    source: "fallback",
    fallback: true,
    fetchedAt: new Date().toISOString(),
    skills: [],
    message,
  });

  if (!endpoint) {
    return fallback("OPENCLAW_SKILLS_RUNTIME_URL not configured; returning fallback runtime snapshot.");
  }

  try {
    const response = await withTimeout(fetch(endpoint, {
      headers: { Accept: "application/json" },
    }), 1500);

    if (!response.ok) {
      return fallback(`Runtime endpoint responded ${response.status}`);
    }

    const payload = await response.json() as any;
    const rows = Array.isArray(payload?.skills) ? payload.skills : [];

    const skills: RuntimeSkill[] = rows
      .map((row: any) => {
        const id = typeof row?.id === "string" ? row.id.trim() : "";
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (!id || !name) return null;

        const enabled = typeof row?.enabled === "boolean" ? row.enabled : undefined;
        const rawStatus = typeof row?.status === "string" ? row.status.trim().toLowerCase() : "";
        const status: RuntimeSkill["status"] =
          rawStatus === "available" || rawStatus === "disabled" || rawStatus === "unknown"
            ? rawStatus
            : (enabled === false ? "disabled" : "available");

        return {
          id,
          name,
          description: typeof row?.description === "string" ? row.description.slice(0, 500) : undefined,
          enabled,
          status,
        } as RuntimeSkill;
      })
      .filter((row: RuntimeSkill | null): row is RuntimeSkill => Boolean(row));

    return {
      runtimeAvailable: true,
      source: "remote_runtime",
      fallback: false,
      fetchedAt: new Date().toISOString(),
      skills,
      message: skills.length
        ? undefined
        : "Runtime available but returned zero skills.",
    };
  } catch (error: any) {
    return fallback(`Runtime fetch failed: ${error?.message || String(error)}`);
  }
}
