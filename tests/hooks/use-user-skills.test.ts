// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserSkills } from "@/hooks/use-user-skills";

const memoryStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => (memoryStorage.has(key) ? memoryStorage.get(key)! : null),
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, String(value));
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key);
  },
  clear: () => {
    memoryStorage.clear();
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));
vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

function makeRes(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as any;
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe("useUserSkills", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    memoryStorage.clear();
  });

  it("fetches server skills and updates local cache", async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/skills") {
        return makeRes(200, {
          skills: [
            {
              id: "skill_1",
              name: "Mi Skill",
              description: "Desc",
              instructions: "Instr",
              category: "custom",
              enabled: true,
              builtIn: false,
              features: [],
              triggers: ["foo"],
              createdAt: new Date("2024-01-01").toISOString(),
              updatedAt: new Date("2024-01-02").toISOString(),
            },
          ],
        });
      }
      throw new Error(`Unexpected apiFetch url: ${url}`);
    });

    const { result } = renderHook(() => useUserSkills(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    const stored = JSON.parse(localStorage.getItem("sira-user-skills") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("skill_1");
  });

  it("migrates missing local skills to the server (import)", async () => {
    localStorage.setItem(
      "sira-user-skills",
      JSON.stringify([
        {
          id: "local_1",
          name: "Local",
          description: "Desc",
          instructions: "Instr",
          category: "custom",
          enabled: true,
          builtIn: false,
          features: [],
          triggers: ["t"],
          createdAt: new Date("2024-01-01").toISOString(),
          updatedAt: new Date("2024-01-01").toISOString(),
        },
      ])
    );

    let importPayload: any = null;

    apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/skills" && (!init || init.method === "GET")) {
        return makeRes(200, { skills: [] });
      }
      if (url === "/api/skills/import") {
        importPayload = JSON.parse(String((init as any)?.body || "{}"));
        return makeRes(200, { imported: [], skipped: 0 });
      }
      throw new Error(`Unexpected apiFetch url: ${url}`);
    });

    renderHook(() => useUserSkills(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/skills/import", expect.any(Object));
    });

    expect(importPayload).toEqual({
      skills: [
        {
          name: "Local",
          description: "Desc",
          instructions: "Instr",
          category: "custom",
          enabled: true,
          features: [],
          triggers: ["t"],
        },
      ],
    });
  });

  it("supports create/update/delete via server and updates cache", async () => {
    const created = {
      id: "skill_2",
      name: "Nuevo",
      description: "Desc",
      instructions: "Instr",
      category: "custom",
      enabled: true,
      builtIn: false,
      features: [],
      triggers: [],
      createdAt: new Date("2024-01-01").toISOString(),
      updatedAt: new Date("2024-01-02").toISOString(),
    };

    const updated = { ...created, description: "Desc 2", updatedAt: new Date("2024-01-03").toISOString() };

    apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/skills" && (!init || init.method === "GET")) {
        return makeRes(200, { skills: [] });
      }
      if (url === "/api/skills" && init?.method === "POST") {
        return makeRes(201, { skill: created });
      }
      if (url === "/api/skills/skill_2" && init?.method === "PUT") {
        return makeRes(200, { skill: updated });
      }
      if (url === "/api/skills/skill_2" && init?.method === "DELETE") {
        return makeRes(200, { success: true });
      }
      throw new Error(`Unexpected apiFetch call: ${url} ${init?.method || "GET"}`);
    });

    const { result } = renderHook(() => useUserSkills(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createSkill({
        name: "Nuevo",
        description: "Desc",
        instructions: "Instr",
        category: "custom",
        enabled: true,
        features: [],
        triggers: [],
      });
    });

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1);
    });

    await act(async () => {
      await result.current.updateSkill("skill_2", { description: "Desc 2" });
    });

    await waitFor(() => {
      expect(result.current.skills[0].description).toBe("Desc 2");
    });

    await act(async () => {
      await result.current.deleteSkill("skill_2");
    });

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(0);
    });
  });
});
