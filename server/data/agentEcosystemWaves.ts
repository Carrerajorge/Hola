export const AGENT_ECOSYSTEM_WAVES = {
  wave1: ["langchain", "flowise", "dify", "agent-zero"],
  wave2: ["ragflow", "ollama", "qdrant"],
  wave3: [
    "n8n",
    "autogen",
    "metagpt",
    "langgraph",
    "open-webui",
    "crewai",
    "browser-use",
    "librechat",
    "searxng",
    "langfuse",
    "openclaw-upstream",
  ],
} as const;

export type AgentEcosystemWaveId = keyof typeof AGENT_ECOSYSTEM_WAVES;
