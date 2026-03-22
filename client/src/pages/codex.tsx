import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  Command,
  FolderOpen,
  GitBranch,
  Layers3,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings2,
  Shield,
  Sparkles,
  TimerReset,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useChats, type Chat, type Message } from "@/hooks/use-chats";
import { useProjects, type Project } from "@/hooks/use-projects";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { createCodexRun, spawnCodexSubagents } from "@/services/codexRuntime";

type SessionStatus = "ready" | "running" | "waiting";
type ActivityTone = "accent" | "success" | "neutral";

interface CodexSession {
  id: string;
  chat: Chat;
  title: string;
  project: Project | null;
  preview: string;
  userPrompt: string;
  assistantOutput: string;
  status: SessionStatus;
  messageCount: number;
  attachmentCount: number;
  timeLabel: string;
  updatedLabel: string;
  branchLabel: string;
}

interface ActivityItem {
  id: string;
  title: string;
  body: string;
  meta: string;
  tone: ActivityTone;
  icon: LucideIcon;
}

interface BranchSummary {
  modifiedFiles: number;
  insertions: number;
  deletions: number;
  label: string;
}

type OpenClawReleaseSyncStatus = "synced" | "update_available" | "tracking_requested" | "offline";

interface OpenClawReleaseInfo {
  tagName: string;
  name: string;
  htmlUrl: string;
  tarballUrl: string | null;
  zipballUrl: string | null;
  publishedAt: string | null;
  overview: string;
  importantNotes: string[];
  highlights: string[];
  notes: string;
  reactionCount: number;
  isLatest: boolean;
}

interface OpenClawReleaseSnapshot {
  requestedTag: string;
  syncedAt: string;
  bundled: {
    version: string | null;
    matchesRequested: boolean;
  };
  requestedRelease: OpenClawReleaseInfo | null;
  latestRelease: OpenClawReleaseInfo | null;
  sync: {
    status: OpenClawReleaseSyncStatus;
    summary: string;
    autoRefreshMinutes: number;
    latestMatchesRequested: boolean;
  };
  errors: string[];
}

interface OpenClawCapabilityStats {
  total: number;
  implemented: number;
  partial: number;
  stub: number;
  missing: number;
  coveragePercent: number;
  gapCount: number;
  gapsByCategory: Record<string, number>;
}

const OPENCLAW_RELEASE_TAG = "v2026.3.13-1";
const OPENCLAW_RELEASE_REFRESH_MS = 15 * 60 * 1000;

const shellStyle: CSSProperties = {
  "--codex-bg": "#f6f3ec",
  "--codex-sidebar": "#e8f0f1",
  "--codex-panel": "rgba(255,255,255,0.92)",
  "--codex-panel-soft": "rgba(255,255,255,0.72)",
  "--codex-border": "rgba(22,31,36,0.11)",
  "--codex-ink": "#171512",
  "--codex-muted": "#6f6a61",
  "--codex-accent": "#1f7a55",
  "--codex-accent-soft": "rgba(31,122,85,0.12)",
  "--codex-accent-ink": "#174f39",
  "--codex-shadow": "0 28px 80px -48px rgba(21,19,16,0.45)",
} as CSSProperties;

const primaryNav = [
  { id: "new", label: "Nuevo hilo", icon: Plus },
  { id: "scheduled", label: "Automatizaciones", icon: Clock3 },
  { id: "dispatch", label: "Habilidades", icon: Sparkles },
] as const;

function normalizeText(value?: string | null): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function toMessageTimestamp(message: Message): number {
  const raw = message.timestamp instanceof Date ? message.timestamp.getTime() : new Date(message.timestamp).getTime();
  return Number.isFinite(raw) ? raw : Date.now();
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatFullDate(value?: string | null): string {
  if (!value) return "Sin fecha remota";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Sin fecha remota";
  return new Intl.DateTimeFormat("es-BO", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatRelativeLabel(timestamp: number): string {
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return "Ahora mismo";
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return `Hace ${diffDays} d`;

  return new Intl.DateTimeFormat("es-BO", {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function formatSectionLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const isToday =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  if (isToday) return "Hoy";

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === date.getFullYear() &&
    yesterday.getMonth() === date.getMonth() &&
    yesterday.getDate() === date.getDate();

  if (isYesterday) return "Ayer";
  return "Anteriores";
}

function getInitials(value?: string | null): string {
  const source = normalizeText(value);
  if (!source) return "IL";

  const parts = source.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function getSessionStatus(chat: Chat): SessionStatus {
  const lastAssistant = [...chat.messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant) return "waiting";
  if (lastAssistant.agentRun?.status === "processing" || lastAssistant.status === "processing") return "running";
  if (lastAssistant.agentRun?.status === "failed" || lastAssistant.status === "failed") return "waiting";
  return "ready";
}

function getLatestRunId(chat: Chat): string | null {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const runId = chat.messages[index]?.agentRun?.runId;
    if (typeof runId === "string" && runId.trim().length > 0) return runId;
  }
  return null;
}

function getStatusLabel(status: SessionStatus): string {
  if (status === "running") return "En ejecución";
  if (status === "waiting") return "En espera";
  return "Listo";
}

function getStatusTone(status: SessionStatus): string {
  if (status === "running") return "bg-[var(--codex-accent-soft)] text-[var(--codex-accent-ink)]";
  if (status === "waiting") return "bg-[#efe7d5] text-[#745b2d]";
  return "bg-[#e9f4ee] text-[var(--codex-accent-ink)]";
}

function buildProjectLookup(projects: Project[]): Map<string, Project> {
  const lookup = new Map<string, Project>();
  for (const project of projects) {
    for (const chatId of project.chatIds) {
      lookup.set(chatId, project);
    }
  }
  return lookup;
}

function buildActivity(session: CodexSession | null): ActivityItem[] {
  if (!session) return [];

  const items: ActivityItem[] = [];
  const recentMessages = session.chat.messages.filter((message) => message.role !== "system").slice(-4);

  for (const message of recentMessages) {
    const timestamp = formatClock(toMessageTimestamp(message));
    const summary = normalizeText(message.agentRun?.summary || message.content);

    if (message.role === "user" && summary) {
      items.push({
        id: message.id,
        title: "Solicitud capturada",
        body: truncateText(summary, 220),
        meta: timestamp,
        tone: "accent",
        icon: Sparkles,
      });
      continue;
    }

    if (message.role === "assistant" && summary) {
      items.push({
        id: message.id,
        title: message.agentRun?.status === "processing" ? "Plan en curso" : "Resultado consolidado",
        body: truncateText(summary, 260),
        meta: timestamp,
        tone: message.agentRun?.status === "processing" ? "accent" : "success",
        icon: message.agentRun?.status === "processing" ? Bot : CheckCircle2,
      });
    }
  }

  return items.slice(0, 3);
}

function validateBranchName(value: string): string | null {
  const branch = value.trim();
  if (!branch) return "El nombre de la rama es obligatorio.";
  if (
    branch.startsWith("-") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("\\") ||
    branch.includes(" ") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock") ||
    branch.includes("//")
  ) {
    return "Usa un nombre de rama válido de Git.";
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    return "Solo se permiten letras, números, puntos, guiones y slash.";
  }
  return null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-BO").format(value);
}

function getOpenClawSyncTone(status: OpenClawReleaseSyncStatus): string {
  if (status === "synced") return "bg-[#e9f4ee] text-[var(--codex-accent-ink)]";
  if (status === "update_available") return "bg-[#efe7d5] text-[#745b2d]";
  if (status === "tracking_requested") return "bg-[var(--codex-accent-soft)] text-[var(--codex-accent-ink)]";
  return "bg-[#f1ece3] text-[var(--codex-muted)]";
}

function getOpenClawSyncLabel(status: OpenClawReleaseSyncStatus): string {
  if (status === "synced") return "Sincronizado";
  if (status === "update_available") return "Nueva release detectada";
  if (status === "tracking_requested") return "Siguiendo release base";
  return "Modo local";
}

async function fetchOpenClawReleaseSnapshot(signal?: AbortSignal): Promise<OpenClawReleaseSnapshot> {
  const query = new URLSearchParams({ tag: OPENCLAW_RELEASE_TAG });
  const response = await apiFetch(`/api/openclaw/release?${query.toString()}`, {
    method: "GET",
    credentials: "include",
    signal,
    timeoutMs: 8_000,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.error === "string" ? payload.error : "No se pudo sincronizar OpenClaw.");
  }

  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "No se pudo sincronizar OpenClaw.");
  }

  return payload as OpenClawReleaseSnapshot;
}

async function fetchOpenClawCapabilityStats(signal?: AbortSignal): Promise<OpenClawCapabilityStats> {
  const response = await apiFetch("/api/openclaw/stats", {
    method: "GET",
    credentials: "include",
    signal,
    timeoutMs: 8_000,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.error === "string" ? payload.error : "No se pudieron cargar las capacidades de OpenClaw.");
  }

  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "No se pudieron cargar las capacidades de OpenClaw.");
  }

  return payload as OpenClawCapabilityStats;
}

export default function CodexPage() {
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, login } = useAuth();
  const { allChats, isLoading: chatsLoading } = useChats();
  const { projects, isLoading: projectsLoading, addChatToProject } = useProjects();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(true);
  const [marathonMode, setMarathonMode] = useState(false);
  const [maxSubagents, setMaxSubagents] = useState(3);
  const [isLaunching, setIsLaunching] = useState(false);
  const [repoBranches, setRepoBranches] = useState<string[]>(["main"]);
  const [activeRepoBranch, setActiveRepoBranch] = useState("main");
  const [branchSummary, setBranchSummary] = useState<BranchSummary | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [isCreateBranchDialogOpen, setIsCreateBranchDialogOpen] = useState(false);
  const [isBranchLoading, setIsBranchLoading] = useState(false);
  const [isBranchActionLoading, setIsBranchActionLoading] = useState(false);
  const [openClawRelease, setOpenClawRelease] = useState<OpenClawReleaseSnapshot | null>(null);
  const [openClawStats, setOpenClawStats] = useState<OpenClawCapabilityStats | null>(null);
  const [isOpenClawLoading, setIsOpenClawLoading] = useState(true);
  const [openClawError, setOpenClawError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"workspace" | "openclaw-ui">("workspace");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const sessions = useMemo<CodexSession[]>(() => {
    const projectLookup = buildProjectLookup(projects);

    return allChats.slice(0, 18).map((chat) => {
      const userMessage = [...chat.messages]
        .reverse()
        .find((message) => message.role === "user" && normalizeText(message.content));
      const assistantMessage = [...chat.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            (normalizeText(message.agentRun?.summary) || normalizeText(message.content))
        );
      const preview = truncateText(
        normalizeText(assistantMessage?.agentRun?.summary || assistantMessage?.content || userMessage?.content || chat.title),
        120,
      );
      const project = projectLookup.get(chat.id) ?? null;
      const attachmentCount = chat.messages.reduce(
        (total, message) => total + (Array.isArray(message.attachments) ? message.attachments.length : 0),
        0,
      );

      return {
        id: chat.id,
        chat,
        title: chat.title || "Nueva sesión",
        project,
        preview,
        userPrompt: truncateText(normalizeText(userMessage?.content || chat.title), 160),
        assistantOutput: truncateText(
          normalizeText(assistantMessage?.agentRun?.summary || assistantMessage?.content || preview),
          240,
        ),
        status: getSessionStatus(chat),
        messageCount: chat.messages.filter((message) => message.role !== "system").length,
        attachmentCount,
        timeLabel: formatClock(chat.timestamp),
        updatedLabel: formatRelativeLabel(chat.timestamp),
        branchLabel: "main",
      };
    });
  }, [allChats, projects]);

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionId(null);
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const safeProjects = useMemo(
    () => (Array.isArray(projects) ? projects : []),
    [projects],
  );

  useEffect(() => {
    if (selectedProjectId) return;
    if (selectedSession?.project?.id) {
      setSelectedProjectId(selectedSession.project.id);
      return;
    }
    if (safeProjects[0]?.id) {
      setSelectedProjectId(safeProjects[0].id);
    }
  }, [safeProjects, selectedProjectId, selectedSession]);

  const selectedProject = useMemo(
    () => safeProjects.find((project) => project.id === selectedProjectId) ?? selectedSession?.project ?? null,
    [safeProjects, selectedProjectId, selectedSession],
  );

  useEffect(() => {
    let isActive = true;
    const abortController = new AbortController();

    const loadOpenClawRelease = async (showLoading = true) => {
      if (showLoading) setIsOpenClawLoading(true);

      try {
        const [releaseResult, statsResult] = await Promise.allSettled([
          fetchOpenClawReleaseSnapshot(abortController.signal),
          fetchOpenClawCapabilityStats(abortController.signal),
        ]);

        if (!isActive) return;

        const nextErrors: string[] = [];

        if (releaseResult.status === "fulfilled") {
          setOpenClawRelease(releaseResult.value);
        } else if (releaseResult.reason?.name !== "AbortError") {
          nextErrors.push(
            releaseResult.reason instanceof Error
              ? releaseResult.reason.message
              : "No se pudo sincronizar OpenClaw.",
          );
        }

        if (statsResult.status === "fulfilled") {
          setOpenClawStats(statsResult.value);
        } else if (statsResult.reason?.name !== "AbortError") {
          nextErrors.push(
            statsResult.reason instanceof Error
              ? statsResult.reason.message
              : "No se pudieron cargar las capacidades de OpenClaw.",
          );
        }

        setOpenClawError(nextErrors.length > 0 ? nextErrors[0] : null);
      } finally {
        if (isActive) setIsOpenClawLoading(false);
      }
    };

    void loadOpenClawRelease(true);
    const intervalId = window.setInterval(() => {
      void loadOpenClawRelease(false);
    }, OPENCLAW_RELEASE_REFRESH_MS);

    return () => {
      isActive = false;
      abortController.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, CodexSession[]>();
    for (const session of sessions) {
      const label = formatSectionLabel(session.chat.timestamp);
      const existing = groups.get(label) ?? [];
      existing.push(session);
      groups.set(label, existing);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }, [sessions]);

  const activityItems = useMemo(() => buildActivity(selectedSession), [selectedSession]);
  const activeRelease = openClawRelease?.requestedRelease;
  const latestRelease = openClawRelease?.latestRelease;
  const releaseHighlights = activeRelease?.highlights || [];
  const releaseNotes = activeRelease?.notes || "";
  const releaseSyncStatus = openClawRelease?.sync.status || "offline";
  const releaseSyncLabel = getOpenClawSyncLabel(releaseSyncStatus);
  const topGapCategories = useMemo(
    () =>
      Object.entries(openClawStats?.gapsByCategory || {})
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3),
    [openClawStats],
  );

  const profileName =
    (isAuthenticated
      ? normalizeText(user?.fullName) || normalizeText(user?.email?.split("@")[0])
      : "") || "Invitado";
  const secureWorkspaceActionLabel = isAuthenticated ? "Abrir chat" : "Entrar al workspace seguro";
  const launchActionLabel = isAuthenticated ? (isLaunching ? "Lanzando" : "Lanzar run") : "Entrar al workspace seguro";
  const composerPlaceholder = isAuthenticated
    ? "Describe la tarea técnica y OpenClaw lanzará un run real con contexto del proyecto, ramas y subagentes."
    : "Inicia sesión para activar runs reales, ramas seguras y el workspace operativo de OpenClaw.";

  const composerTarget = selectedSession ? `/chat/${selectedSession.id}` : "/";
  const launchRunId = selectedSession ? getLatestRunId(selectedSession.chat) : null;

  const transcriptMessages = useMemo(
    () =>
      (selectedSession?.chat.messages || [])
        .filter((message) => message.role !== "system")
        .sort((left, right) => toMessageTimestamp(left) - toMessageTimestamp(right)),
    [selectedSession],
  );

  const workspaceLabel = useMemo(() => {
    const pathSource = selectedProject?.repositoryPath || selectedProject?.name || "";
    const tail = pathSource.split(/[\\/]/).filter(Boolean).slice(-1)[0];
    return tail || selectedProject?.name || "Hola";
  }, [selectedProject]);

  const branchButtonLabel = activeRepoBranch || selectedSession?.branchLabel || "main";

  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    const ordered = [...repoBranches].sort((left, right) => {
      if (left === activeRepoBranch) return -1;
      if (right === activeRepoBranch) return 1;
      return left.localeCompare(right);
    });
    if (!query) return ordered;
    return ordered.filter((branch) => branch.toLowerCase().includes(query));
  }, [activeRepoBranch, branchQuery, repoBranches]);

  const openSelectedChat = () => {
    if (!isAuthenticated) {
      login();
      return;
    }
    setLocation(composerTarget);
  };

  const focusComposer = () => {
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const refreshOpenClawRelease = useCallback(async () => {
    setIsOpenClawLoading(true);
    try {
      const [snapshot, stats] = await Promise.all([
        fetchOpenClawReleaseSnapshot(),
        fetchOpenClawCapabilityStats(),
      ]);
      setOpenClawRelease(snapshot);
      setOpenClawStats(stats);
      setOpenClawError(null);
      toast.success("OpenClaw actualizado", {
        description: "Traje la release, la cobertura y verifiqué si hay cambios nuevos en GitHub.",
      });
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : "No se pudo sincronizar OpenClaw.");
      toast.error("No se pudo sincronizar OpenClaw", {
        description: error instanceof Error ? error.message : "Error inesperado al consultar la release.",
      });
    } finally {
      setIsOpenClawLoading(false);
    }
  }, []);

  const loadRepositoryBranches = useCallback(async (project: Project | null) => {
    if (!isAuthenticated) {
      setRepoBranches(["main"]);
      setActiveRepoBranch("main");
      setBranchSummary(null);
      return;
    }

    if (!project?.repositoryPath) {
      setRepoBranches(["main"]);
      setActiveRepoBranch("main");
      setBranchSummary(null);
      return;
    }

    setIsBranchLoading(true);
    try {
      const params = new URLSearchParams({ rootPath: project.repositoryPath });
      const response = await apiFetch(`/api/local/repo/branches?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "No se pudieron cargar las ramas del repositorio.");
      }

      const payload = await response.json();
      const nextBranches = Array.isArray(payload?.branches)
        ? payload.branches.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      const normalizedBranches = nextBranches.length > 0 ? nextBranches : ["main"];
      setRepoBranches(normalizedBranches);
      setActiveRepoBranch(
        typeof payload?.current === "string" && normalizedBranches.includes(payload.current)
          ? payload.current
          : normalizedBranches[0],
      );
      setBranchSummary(
        payload?.summary && typeof payload.summary === "object"
          ? {
              modifiedFiles: Number(payload.summary.modifiedFiles || 0),
              insertions: Number(payload.summary.insertions || 0),
              deletions: Number(payload.summary.deletions || 0),
              label: String(payload.summary.label || "Sin cambios pendientes"),
            }
          : null,
      );
    } catch (error) {
      console.warn("[codex] Failed to load branches:", error);
      setRepoBranches(["main"]);
      setActiveRepoBranch("main");
      setBranchSummary(null);
    } finally {
      setIsBranchLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadRepositoryBranches(selectedProject);
  }, [loadRepositoryBranches, selectedProject]);

  const handleSelectBranch = useCallback(
    async (branch: string) => {
      if (!selectedProject?.repositoryPath || branch === activeRepoBranch) {
        setIsBranchMenuOpen(false);
        return;
      }

      setIsBranchActionLoading(true);
      try {
        const response = await apiFetch("/api/local/repo/branches/switch", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootPath: selectedProject.repositoryPath,
            branch,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "No se pudo cambiar de rama.");
        }

        setRepoBranches(Array.isArray(payload?.branches) ? payload.branches : [branch]);
        setActiveRepoBranch(typeof payload?.current === "string" ? payload.current : branch);
        setBranchSummary(
          payload?.summary && typeof payload.summary === "object"
            ? {
                modifiedFiles: Number(payload.summary.modifiedFiles || 0),
                insertions: Number(payload.summary.insertions || 0),
                deletions: Number(payload.summary.deletions || 0),
                label: String(payload.summary.label || "Sin cambios pendientes"),
              }
            : null,
        );
        setIsBranchMenuOpen(false);
        setBranchQuery("");
        toast.success("Rama actualizada", {
          description: `Ahora estás trabajando en ${branch}.`,
        });
      } catch (error) {
        toast.error("No se pudo cambiar de rama", {
          description: error instanceof Error ? error.message : "Error inesperado al cambiar la rama.",
        });
      } finally {
        setIsBranchActionLoading(false);
      }
    },
    [activeRepoBranch, selectedProject?.repositoryPath],
  );

  const handleCreateBranch = useCallback(
    async (branch: string) => {
      if (!selectedProject?.repositoryPath) {
        throw new Error("Primero conecta un repositorio al proyecto.");
      }

      const response = await apiFetch("/api/local/repo/branches/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath: selectedProject.repositoryPath,
          branch,
          checkout: true,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo crear la rama.");
      }

      setRepoBranches(Array.isArray(payload?.branches) ? payload.branches : [branch]);
      setActiveRepoBranch(typeof payload?.current === "string" ? payload.current : branch);
      setBranchSummary(
        payload?.summary && typeof payload.summary === "object"
          ? {
              modifiedFiles: Number(payload.summary.modifiedFiles || 0),
              insertions: Number(payload.summary.insertions || 0),
              deletions: Number(payload.summary.deletions || 0),
              label: String(payload.summary.label || "Sin cambios pendientes"),
            }
          : null,
      );
      setBranchQuery("");
      toast.success("Rama creada", {
        description: `Quedó creada y activa: ${branch}.`,
      });
    },
    [selectedProject?.repositoryPath],
  );

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleLaunch();
    }
  };

  const handleLaunch = async () => {
    const task = draft.trim();
    if (!task || isLaunching) return;
    if (!isAuthenticated) {
      login();
      return;
    }

    const shouldReuseSelectedChat =
      !!selectedSession &&
      (!selectedProject || selectedProject.id === selectedSession.project?.id);

    setIsLaunching(true);

    try {
      const { runId, chatId } = await createCodexRun({
        chatId: shouldReuseSelectedChat ? selectedSession?.id : null,
        message: task,
        project: selectedProject,
        marathonMode,
      });

      if (selectedProject?.id) {
        addChatToProject(chatId, selectedProject.id);
      }

      if (multiAgentEnabled) {
        const spawned = await spawnCodexSubagents({
          runId,
          message: task,
          project: selectedProject,
          marathonMode,
          maxSubagents,
        });

        if (spawned.length > 0) {
          toast.success("Subagentes lanzados", {
            description: `${spawned.length} agente(s) de apoyo quedaron trabajando para este run.`,
          });
        }
      }

      setDraft("");
      setSelectedSessionId(chatId);
      toast.success("OpenClaw en ejecución", {
        description: multiAgentEnabled
          ? "Abrí el progreso del run con agentes delegados activos."
          : "Abrí el progreso del run principal.",
      });
      setLocation(`/runs/${runId}/progress`);
    } catch (error) {
      toast.error("No se pudo iniciar OpenClaw", {
        description: error instanceof Error ? error.message : "Error inesperado al lanzar el run.",
      });
    } finally {
      setIsLaunching(false);
    }
  };

  const handleWorktreeShortcut = () => {
    setDraft(`Crea un worktree aislado para la rama ${branchButtonLabel} y mueve allí esta tarea con todo el contexto necesario.`);
    focusComposer();
  };

  const handleCommitShortcut = () => {
    if (draft.trim()) {
      void handleLaunch();
      return;
    }
    setDraft(`Confirma los cambios pendientes de la rama ${branchButtonLabel} con un commit claro, seguro y listo para revisión.`);
    focusComposer();
  };

  return (
    <div
      className="min-h-screen bg-[var(--codex-bg)] text-[var(--codex-ink)]"
      style={shellStyle}
      data-testid="codex-page"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[320px] bg-[radial-gradient(circle_at_top,_rgba(205,223,226,0.85),_transparent_62%)]" />
        <div className="absolute right-[-8%] top-[18%] h-80 w-80 rounded-full bg-[rgba(230,222,200,0.32)] blur-3xl" />
      </div>

      <div className="relative flex min-h-screen">
        <aside className="hidden w-[320px] shrink-0 border-r border-[var(--codex-border)] bg-[var(--codex-sidebar)]/92 px-4 py-6 backdrop-blur-xl md:flex md:flex-col">
          <div className="flex items-center justify-between gap-3 px-2">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--codex-border)] bg-white/80 shadow-sm">
                <Code2 className="h-5 w-5 text-[var(--codex-accent)]" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--codex-muted)]">ILIAGPT</p>
                <p className="text-lg font-semibold">OpenClaw</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full border border-[var(--codex-border)] bg-white/80"
              onClick={() => setLocation("/")}
              aria-label="Volver al chat principal"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-7 space-y-1.5">
            {primaryNav.map((item, index) => {
              const Icon = item.icon;
              const isActive = index === 0;
              const action =
                item.id === "new"
                  ? () => setLocation("/")
                  : item.id === "scheduled"
                    ? () => setLocation("/settings")
                    : () => setLocation("/skills");
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={action}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-base transition-all duration-200 hover:bg-white/75",
                    isActive && "bg-white/88 shadow-sm",
                  )}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--codex-border)] bg-white/80 text-[var(--codex-muted)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-7 flex items-center justify-between px-2">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Hilos</p>
            <span className="text-xs text-[var(--codex-muted)]">{sessions.length}</span>
          </div>

          <ScrollArea className="mt-4 flex-1 pr-1">
            <div className="space-y-5">
              <div className="rounded-[24px] border border-[var(--codex-border)] bg-white/72 p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--codex-accent-soft)] text-[var(--codex-accent-ink)]">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{selectedProject?.name || workspaceLabel}</p>
                    <p className="truncate text-sm text-[var(--codex-muted)]">{selectedProject?.repositoryPath || "Workspace listo"}</p>
                  </div>
                </div>
              </div>

              {groupedSessions.length > 0 ? (
                groupedSessions.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <p className="px-2 text-xs font-medium text-[var(--codex-muted)]">{group.label}</p>
                    {group.items.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          if (session.project?.id) setSelectedProjectId(session.project.id);
                        }}
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition-all duration-200 hover:border-[var(--codex-border)] hover:bg-white/78",
                          selectedSessionId === session.id && "border-[var(--codex-border)] bg-white/88 shadow-sm",
                        )}
                        data-testid={`codex-session-${session.id}`}
                      >
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--codex-accent)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-base font-medium">{session.title}</p>
                            <span className="text-xs text-[var(--codex-muted)]">{session.timeLabel}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--codex-muted)]">
                            {session.preview || "Sesión lista para retomarse desde OpenClaw."}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-[var(--codex-border)] px-4 py-5 text-sm text-[var(--codex-muted)]">
                  Todavía no hay sesiones recientes. Crea una conversación y aquí aparecerá el historial.
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-5 border-t border-[var(--codex-border)] pt-4">
            <button
              type="button"
              onClick={() => setLocation("/settings")}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-white/75"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--codex-border)] bg-white/80 text-[var(--codex-muted)]">
                <Settings2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">Configuración</p>
                <p className="truncate text-sm text-[var(--codex-muted)]">{profileName}</p>
              </div>
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-[var(--codex-border)] bg-[rgba(247,245,240,0.78)] backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 md:px-6 lg:px-8">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-full border border-[var(--codex-border)] bg-white/80 p-2 md:hidden"
                    onClick={() => setLocation("/")}
                    aria-label="Volver"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 text-sm text-[var(--codex-muted)]">
                      <span className="truncate">{workspaceLabel}</span>
                      <span>•</span>
                      <span>{selectedProject?.name || "Workspace general"}</span>
                    </div>
                    <button
                      type="button"
                      className="mt-1 flex max-w-full items-center gap-2 text-left"
                      data-testid="codex-session-title"
                    >
                      <span className="truncate text-2xl font-semibold md:text-[2rem]">
                        {selectedSession?.title || "Abrir workspace seguro OpenClaw"}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-[var(--codex-muted)]" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="icon" className="rounded-full border border-[var(--codex-border)] bg-white/82">
                  <Settings2 className="h-4 w-4" />
                </Button>
                <button
                  type="button"
                  onClick={() => setMultiAgentEnabled((current) => !current)}
                  disabled={!isAuthenticated}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
                    multiAgentEnabled
                      ? "border-[var(--codex-accent)] bg-[var(--codex-accent-soft)] text-[var(--codex-accent-ink)]"
                      : "border-[var(--codex-border)] bg-white/82 text-[var(--codex-muted)]",
                    !isAuthenticated && "cursor-not-allowed opacity-60",
                  )}
                >
                  <Users2 className="h-4 w-4" />
                  {multiAgentEnabled ? `Multi-agent x${maxSubagents}` : "Single-agent"}
                </button>
                <button
                  type="button"
                  onClick={handleWorktreeShortcut}
                  disabled={!isAuthenticated}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/82 px-4 py-2 text-sm",
                    !isAuthenticated && "cursor-not-allowed opacity-60",
                  )}
                >
                  <FolderOpen className="h-4 w-4" />
                  Mover al worktree
                </button>
                <button
                  type="button"
                  onClick={handleCommitShortcut}
                  disabled={!isAuthenticated}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/82 px-4 py-2 text-sm",
                    !isAuthenticated && "cursor-not-allowed opacity-60",
                  )}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmar
                </button>
                <div className="inline-flex items-center gap-3 rounded-full border border-[var(--codex-border)] bg-white/82 px-4 py-2 text-sm tabular-nums">
                  <span className="text-[var(--codex-accent)]">+{formatNumber(branchSummary?.insertions || 0)}</span>
                  <span className="text-[#b64034]">-{formatNumber(branchSummary?.deletions || 0)}</span>
                </div>
              </div>
            </div>
          </header>

          {/* View toggle tabs */}
          <div className="flex items-center gap-1 border-b border-[var(--codex-border)] bg-[rgba(247,245,240,0.6)] px-4 md:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setActiveView("workspace")}
              className={cn(
                "relative px-5 py-3 text-sm font-medium transition-colors",
                activeView === "workspace"
                  ? "text-[var(--codex-accent-ink)]"
                  : "text-[var(--codex-muted)] hover:text-[var(--codex-ink)]",
              )}
            >
              Workspace
              {activeView === "workspace" && (
                <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--codex-accent)]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveView("openclaw-ui")}
              className={cn(
                "relative px-5 py-3 text-sm font-medium transition-colors",
                activeView === "openclaw-ui"
                  ? "text-[var(--codex-accent-ink)]"
                  : "text-[var(--codex-muted)] hover:text-[var(--codex-ink)]",
              )}
            >
              OpenClaw UI
              {activeView === "openclaw-ui" && (
                <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--codex-accent)]" />
              )}
            </button>
          </div>

          {activeView === "openclaw-ui" ? (
            <div className="flex-1 overflow-hidden">
              <iframe
                src="/openclaw-ui/"
                title="OpenClaw Control UI"
                className="h-full w-full border-0"
                style={{ minHeight: "calc(100vh - 160px)" }}
                allow="clipboard-read; clipboard-write"
              />
            </div>
          ) : (
          <>
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto w-full max-w-5xl px-4 pb-40 pt-8 md:px-6 lg:px-8">
                {!isAuthenticated ? (
                  <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[30px] border border-[var(--codex-border)] bg-[rgba(255,255,255,0.86)] px-5 py-4 shadow-[var(--codex-shadow)]">
                    <div className="max-w-3xl">
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--codex-muted)]">Vista previa abierta</p>
                      <p className="mt-2 text-base leading-7 text-[var(--codex-ink)]">
                        Esta ruta deja ver OpenClaw dentro de tu plataforma aun si el login o la base local no estan listos.
                        Para lanzar runs, abrir chats reales y trabajar en el workspace seguro, inicia sesion.
                      </p>
                    </div>
                    <Button
                      className="rounded-full bg-[var(--codex-accent)] px-5 text-white hover:bg-[var(--codex-accent)]/90"
                      onClick={login}
                    >
                      <LogIn className="mr-2 h-4 w-4" />
                      Entrar al workspace seguro
                    </Button>
                  </section>
                ) : null}

                {selectedSession ? (
                  <div className="space-y-6">
                    <section className="grid gap-4 md:grid-cols-[1.35fr_0.65fr]">
                      <div className="rounded-[32px] border border-[var(--codex-border)] bg-[var(--codex-panel)] p-6 shadow-[var(--codex-shadow)]">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--codex-accent-soft)] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[var(--codex-accent-ink)]">
                                <Layers3 className="h-3.5 w-3.5" />
                                OpenClaw Integrado
                              </span>
                              <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm", getOpenClawSyncTone(releaseSyncStatus))}>
                                <Shield className="h-4 w-4" />
                                {releaseSyncLabel}
                              </span>
                            </div>
                            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                              {activeRelease?.name || "OpenClaw listo dentro de tu plataforma"}
                            </h2>
                            <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--codex-muted)]">
                              {activeRelease?.overview ||
                                "OpenClaw queda montado como una experiencia segura dentro de ILIAGPT para que el usuario vea la release, entienda el contexto y use el workspace desde aquí."}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void refreshOpenClawRelease()}
                              className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/82 px-4 py-2 text-sm transition-colors hover:bg-white"
                            >
                              {isOpenClawLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              Actualizar
                            </button>
                            <a
                              href={activeRelease?.htmlUrl || `https://github.com/openclaw/openclaw/releases/tag/${OPENCLAW_RELEASE_TAG}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/82 px-4 py-2 text-sm transition-colors hover:bg-white"
                            >
                              Ver release
                              <ArrowUpRight className="h-4 w-4" />
                            </a>
                          </div>
                        </div>

                        <div className="mt-6 grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Release fijada</p>
                            <p className="mt-2 text-lg font-semibold">{activeRelease?.tagName || OPENCLAW_RELEASE_TAG}</p>
                            <p className="mt-1 text-sm text-[var(--codex-muted)]">
                              Bundle local {openClawRelease?.bundled.version || "sin versión detectada"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Publicada</p>
                            <p className="mt-2 text-lg font-semibold">{formatFullDate(activeRelease?.publishedAt)}</p>
                            <p className="mt-1 text-sm text-[var(--codex-muted)]">Release oficial consultada desde GitHub</p>
                          </div>
                          <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Última detectada</p>
                            <p className="mt-2 text-lg font-semibold">{latestRelease?.tagName || "Sin señal remota"}</p>
                            <p className="mt-1 text-sm text-[var(--codex-muted)]">
                              {latestRelease?.tagName === activeRelease?.tagName ? "Ya está alineada con esta vista." : "Hay cambios nuevos listos para reflejarse."}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Cobertura</p>
                            <p className="mt-2 text-lg font-semibold">
                              {typeof openClawStats?.coveragePercent === "number" ? `${openClawStats.coveragePercent}%` : "Sin dato"}
                            </p>
                            <p className="mt-1 text-sm text-[var(--codex-muted)]">Mapa OpenClaw 500 dentro de la plataforma</p>
                          </div>
                          <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Capacidades</p>
                            <p className="mt-2 text-lg font-semibold">
                              {formatNumber(openClawStats?.implemented || 0)} / {formatNumber(openClawStats?.total || 500)}
                            </p>
                            <p className="mt-1 text-sm text-[var(--codex-muted)]">Implementadas o visibles en el mapeo actual</p>
                          </div>
                          <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Brechas</p>
                            <p className="mt-2 text-lg font-semibold">{formatNumber(openClawStats?.gapCount || 0)}</p>
                            <p className="mt-1 text-sm text-[var(--codex-muted)]">Huecos pendientes para cerrar al 100%</p>
                          </div>
                        </div>

                        {releaseHighlights.length > 0 ? (
                          <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                            <div className="rounded-[24px] border border-[var(--codex-border)] bg-white/82 p-5">
                              <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Cambios clave</p>
                              <div className="mt-4 space-y-3">
                                {releaseHighlights.map((highlight, index) => (
                                  <div key={`${highlight}-${index}`} className="flex items-start gap-3 rounded-2xl bg-[#f7f5ef] px-4 py-3">
                                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--codex-accent)]" />
                                    <p className="text-sm leading-6 text-[var(--codex-ink)]">{highlight}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-[24px] border border-[var(--codex-border)] bg-white/82 p-5">
                              <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Notas importantes</p>
                              <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--codex-muted)]">
                                {(activeRelease?.importantNotes.length ? activeRelease.importantNotes : [
                                  "La web consulta la release fija y también revisa la última release disponible.",
                                  "Si OpenClaw cambia en GitHub, esta vista puede mostrar el nuevo estado al refrescarse.",
                                ]).map((note, index) => (
                                  <div key={`${note}-${index}`} className="rounded-2xl bg-[#f7f5ef] px-4 py-3 text-[var(--codex-ink)]">
                                    {note}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-4">
                        <section className="rounded-[32px] border border-[var(--codex-border)] bg-[var(--codex-panel-soft)] p-5 shadow-[var(--codex-shadow)]">
                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--codex-muted)]">Sincronización web</p>
                          <p className="mt-3 text-base leading-7 text-[var(--codex-ink)]">
                            {openClawRelease?.sync.summary ||
                              "La vista queda preparada para revisar OpenClaw y detectar cambios remotos automáticamente."}
                          </p>
                          <div className="mt-4 space-y-3 text-sm text-[var(--codex-muted)]">
                            <p>Última revisión: {formatFullDate(openClawRelease?.syncedAt)}</p>
                            <p>Frecuencia automática: cada {openClawRelease?.sync.autoRefreshMinutes || 15} minutos.</p>
                            <p>Reacciones en GitHub: {formatNumber(activeRelease?.reactionCount || 0)}</p>
                            <p>Cobertura verificada: {typeof openClawStats?.coveragePercent === "number" ? `${openClawStats.coveragePercent}%` : "Sin dato"}</p>
                          </div>
                          {openClawError ? (
                            <div className="mt-4 rounded-2xl border border-dashed border-[#d7c6a1] bg-[#f8f1de] px-4 py-3 text-sm text-[#745b2d]">
                              {openClawError}
                            </div>
                          ) : null}
                          {topGapCategories.length > 0 ? (
                            <div className="mt-4 rounded-2xl border border-[var(--codex-border)] bg-white/80 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Brechas mas altas</p>
                              <div className="mt-3 space-y-2 text-sm text-[var(--codex-ink)]">
                                {topGapCategories.map(([category, count]) => (
                                  <div key={category} className="flex items-center justify-between gap-3">
                                    <span className="truncate">{category.replace(/_/g, " ")}</span>
                                    <span className="font-medium">{formatNumber(count)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </section>

                        <section className="rounded-[32px] border border-[var(--codex-border)] bg-[var(--codex-panel-soft)] p-5 shadow-[var(--codex-shadow)]">
                          <p className="text-xs uppercase tracking-[0.2em] text-[var(--codex-muted)]">Workspace seguro</p>
                          <div className="mt-4 space-y-4">
                            <div>
                              <p className="text-base leading-7 text-[var(--codex-ink)]">
                                {isAuthenticated
                                  ? selectedSession.assistantOutput || selectedSession.preview || "Sesión lista para continuar con OpenClaw."
                                  : "La vista ya refleja OpenClaw dentro de tu plataforma. Inicia sesion para abrir el workspace seguro, activar runs y operar con ramas reales."}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div className="rounded-2xl border border-[var(--codex-border)] bg-white/80 px-4 py-3">
                                <p className="text-[var(--codex-muted)]">Run</p>
                                <p className="mt-1 font-semibold">{launchRunId ? "Activo" : "Listo"}</p>
                              </div>
                              <div className="rounded-2xl border border-[var(--codex-border)] bg-white/80 px-4 py-3">
                                <p className="text-[var(--codex-muted)]">Ventana</p>
                                <p className="mt-1 font-semibold">{marathonMode ? "12h" : "Normal"}</p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-[var(--codex-border)] bg-white/80 px-4 py-3 text-sm text-[var(--codex-muted)]">
                              <p className="font-medium text-[var(--codex-ink)]">{selectedProject?.repositoryPath || "Sin repositorio conectado"}</p>
                              <p className="mt-1">{branchSummary?.label || "Sin cambios pendientes"}</p>
                            </div>
                          </div>
                        </section>
                      </div>
                    </section>

                    {releaseNotes ? (
                      <section className="overflow-hidden rounded-[34px] border border-[var(--codex-border)] bg-[var(--codex-panel)] shadow-[var(--codex-shadow)]">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--codex-border)] px-6 py-5">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Notas completas de la release</p>
                            <p className="mt-2 text-sm text-[var(--codex-muted)]">
                              OpenClaw {activeRelease?.tagName || OPENCLAW_RELEASE_TAG} dentro de ILIAGPT
                            </p>
                          </div>
                          {activeRelease?.tarballUrl ? (
                            <a
                              href={activeRelease.tarballUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/82 px-4 py-2 text-sm transition-colors hover:bg-white"
                            >
                              Descargar tarball
                              <ArrowUpRight className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                        <div className="max-h-[26rem] overflow-y-auto px-6 py-6">
                          <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--codex-ink)]">
                            {releaseNotes}
                          </pre>
                        </div>
                      </section>
                    ) : null}

                    <section className="overflow-hidden rounded-[34px] border border-[var(--codex-border)] bg-[var(--codex-panel)] shadow-[var(--codex-shadow)]">
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--codex-border)] px-6 py-5">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Sesión OpenClaw</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm",
                                getStatusTone(selectedSession.status),
                              )}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {getStatusLabel(selectedSession.status)}
                            </span>
                            <span className="text-sm text-[var(--codex-muted)]">
                              {selectedSession.messageCount} eventos · {selectedSession.attachmentCount} adjunto(s)
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          className="rounded-full border border-[var(--codex-border)] bg-white/82 px-4"
                          onClick={openSelectedChat}
                          data-testid="codex-open-chat"
                        >
                          {secureWorkspaceActionLabel}
                          <ArrowUpRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-8 px-6 py-6">
                        {transcriptMessages.map((message) => {
                          const timestamp = formatClock(toMessageTimestamp(message));
                          const summary = normalizeText(message.agentRun?.summary || message.content) || "Sin contenido visible.";
                          const isUser = message.role === "user";
                          const stepPreview = Array.isArray(message.agentRun?.steps)
                            ? message.agentRun.steps
                                .slice(0, 2)
                                .map((step) => ({
                                  key: `${message.id}-${step.stepIndex}`,
                                  title: step.toolName || "Paso registrado",
                                  body: truncateText(
                                    normalizeText(typeof step.output === "string" ? step.output : JSON.stringify(step.output ?? "")) ||
                                      "Actividad registrada por el agente.",
                                    120,
                                  ),
                                }))
                            : [];

                          return (
                            <article key={message.id} className="space-y-3">
                              <div className="flex items-center gap-3 text-sm text-[var(--codex-muted)]">
                                <span className="font-medium text-[var(--codex-ink)]">
                                  {isUser ? profileName : "OpenClaw"}
                                </span>
                                <span>{timestamp}</span>
                                {!isUser && message.agentRun?.status ? (
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                                      getStatusTone(getSessionStatus({ ...selectedSession.chat, messages: [message] } as Chat)),
                                    )}
                                  >
                                    {message.agentRun.status}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={cn(
                                  "max-w-[88%] rounded-[28px] border px-5 py-4 shadow-sm",
                                  isUser
                                    ? "border-[var(--codex-border)] bg-[#f7f2e8] ml-auto"
                                    : "border-[var(--codex-border)] bg-white",
                                )}
                              >
                                <p className="text-[15px] leading-8 text-[var(--codex-ink)]">{summary}</p>
                                {stepPreview.length > 0 ? (
                                  <div className="mt-4 space-y-2 border-t border-[var(--codex-border)] pt-4">
                                    {stepPreview.map((step) => (
                                      <div key={step.key} className="rounded-2xl bg-[#f6f4ee] px-4 py-3">
                                        <p className="text-sm font-medium">{step.title}</p>
                                        <p className="mt-1 text-sm leading-6 text-[var(--codex-muted)]">{step.body}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}

                        {activityItems.length > 0 ? (
                          <div className="border-t border-[var(--codex-border)] pt-6">
                            <div className="space-y-3">
                              {activityItems.map((item) => {
                                const Icon = item.icon;
                                return (
                                  <div key={item.id} className="flex items-start gap-3 rounded-2xl bg-[#f7f5ef] px-4 py-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[var(--codex-accent-ink)]">
                                      <Icon className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium">{item.title}</p>
                                        <span className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">{item.meta}</span>
                                      </div>
                                      <p className="mt-1 text-sm leading-6 text-[var(--codex-muted)]">{item.body}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>
                ) : (
                  <section className="mx-auto flex w-full max-w-4xl flex-col items-center rounded-[34px] border border-[var(--codex-border)] bg-[var(--codex-panel)] px-6 py-16 text-center shadow-[var(--codex-shadow)]">
                    <div className="flex h-20 w-20 items-center justify-center rounded-[28px] border border-[var(--codex-border)] bg-white/80 shadow-sm">
                      <Code2 className="h-9 w-9 text-[var(--codex-accent)]" />
                    </div>
                    <h1 className="mt-8 text-4xl font-semibold tracking-tight md:text-5xl">
                      OpenClaw listo para mostrarse en tu plataforma
                    </h1>
                    <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--codex-muted)]">
                      OpenClaw queda integrado dentro de un workspace dedicado para que el usuario vea la release oficial, entienda sus cambios y use tu plataforma segura desde aquí.
                    </p>
                    <div className="mt-8 grid w-full gap-3 text-left md:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Release fijada</p>
                        <p className="mt-2 text-lg font-semibold">{activeRelease?.tagName || OPENCLAW_RELEASE_TAG}</p>
                        <p className="mt-1 text-sm text-[var(--codex-muted)]">{activeRelease?.name || "OpenClaw release oficial"}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Estado web</p>
                        <p className="mt-2 text-lg font-semibold">{releaseSyncLabel}</p>
                        <p className="mt-1 text-sm text-[var(--codex-muted)]">{openClawRelease?.sync.summary || "Esperando sincronización inicial."}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Publicada</p>
                        <p className="mt-2 text-lg font-semibold">{formatFullDate(activeRelease?.publishedAt)}</p>
                        <p className="mt-1 text-sm text-[var(--codex-muted)]">GitHub oficial de OpenClaw</p>
                      </div>
                    </div>
                    <div className="mt-3 grid w-full gap-3 text-left md:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Cobertura</p>
                        <p className="mt-2 text-lg font-semibold">
                          {typeof openClawStats?.coveragePercent === "number" ? `${openClawStats.coveragePercent}%` : "Sin dato"}
                        </p>
                        <p className="mt-1 text-sm text-[var(--codex-muted)]">Estado del mapa OpenClaw 500</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Capacidades</p>
                        <p className="mt-2 text-lg font-semibold">
                          {formatNumber(openClawStats?.implemented || 0)} / {formatNumber(openClawStats?.total || 500)}
                        </p>
                        <p className="mt-1 text-sm text-[var(--codex-muted)]">Implementadas o visibles hoy</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Brechas</p>
                        <p className="mt-2 text-lg font-semibold">{formatNumber(openClawStats?.gapCount || 0)}</p>
                        <p className="mt-1 text-sm text-[var(--codex-muted)]">Categorias aun por cerrar</p>
                      </div>
                    </div>
                    {releaseHighlights.length > 0 ? (
                      <div className="mt-8 w-full rounded-[28px] border border-[var(--codex-border)] bg-white/82 p-5 text-left">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Cambios clave</p>
                        <div className="mt-4 space-y-3">
                          {releaseHighlights.slice(0, 4).map((highlight, index) => (
                            <div key={`${highlight}-${index}`} className="rounded-2xl bg-[#f7f5ef] px-4 py-3 text-sm leading-6 text-[var(--codex-ink)]">
                              {highlight}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {topGapCategories.length > 0 ? (
                      <div className="mt-6 w-full rounded-[28px] border border-[var(--codex-border)] bg-white/82 p-5 text-left">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Brechas mas altas</p>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          {topGapCategories.map(([category, count]) => (
                            <div key={category} className="rounded-2xl bg-[#f7f5ef] px-4 py-3">
                              <p className="text-sm font-medium text-[var(--codex-ink)]">{category.replace(/_/g, " ")}</p>
                              <p className="mt-1 text-sm text-[var(--codex-muted)]">{formatNumber(count)} items pendientes</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {releaseNotes ? (
                      <div className="mt-6 w-full overflow-hidden rounded-[28px] border border-[var(--codex-border)] bg-white/82 text-left">
                        <div className="border-b border-[var(--codex-border)] px-5 py-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">Notas completas de la release</p>
                          <p className="mt-2 text-sm text-[var(--codex-muted)]">
                            OpenClaw {activeRelease?.tagName || OPENCLAW_RELEASE_TAG} dentro de ILIAGPT
                          </p>
                        </div>
                        <div className="max-h-[22rem] overflow-y-auto px-5 py-5">
                          <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--codex-ink)]">
                            {releaseNotes}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                    <Button
                      className="mt-10 rounded-full bg-[var(--codex-accent)] px-6 text-white hover:bg-[var(--codex-accent)]/90"
                      onClick={() => {
                        if (isAuthenticated) {
                          setLocation("/");
                          return;
                        }
                        login();
                      }}
                    >
                      {isAuthenticated ? "Abrir chat principal" : "Entrar al workspace seguro"}
                    </Button>
                  </section>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="sticky bottom-0 border-t border-[var(--codex-border)] bg-[rgba(247,245,240,0.88)] backdrop-blur-xl">
            <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-4 md:px-6 lg:px-8">
              <div className="rounded-[30px] border border-[var(--codex-border)] bg-white/92 p-3 shadow-[var(--codex-shadow)]">
                <Textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={composerPlaceholder}
                  disabled={!isAuthenticated}
                  className="min-h-[96px] resize-none border-0 bg-transparent px-4 py-4 text-base leading-7 shadow-none focus-visible:ring-0"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMultiAgentEnabled((value) => !value)}
                      disabled={!isAuthenticated}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                        multiAgentEnabled
                          ? "border-[var(--codex-accent)] bg-[var(--codex-accent-soft)] text-[var(--codex-accent-ink)]"
                          : "border-[var(--codex-border)] text-[var(--codex-muted)]",
                        !isAuthenticated && "cursor-not-allowed opacity-60",
                      )}
                      data-testid="codex-multi-agent-toggle"
                    >
                      <Users2 className="h-4 w-4" />
                      {multiAgentEnabled ? `Multi-agent x${maxSubagents}` : "Single-agent"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMarathonMode((value) => !value)}
                      disabled={!isAuthenticated}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                        marathonMode
                          ? "border-[var(--codex-accent)] bg-[var(--codex-accent-soft)] text-[var(--codex-accent-ink)]"
                          : "border-[var(--codex-border)] text-[var(--codex-muted)]",
                        !isAuthenticated && "cursor-not-allowed opacity-60",
                      )}
                      data-testid="codex-marathon-toggle"
                    >
                      <TimerReset className="h-4 w-4" />
                      {marathonMode ? "Modo 12h" : "Modo estándar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaxSubagents((current) => (current >= 4 ? 1 : current + 1))}
                      disabled={!isAuthenticated}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] px-3 py-2 text-sm text-[var(--codex-muted)] transition-colors hover:bg-[#faf8f3]",
                        !isAuthenticated && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <Command className="h-4 w-4" />
                      Subagentes: {maxSubagents}
                    </button>
                    {selectedProject ? (
                      <span className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] px-3 py-2 text-sm text-[var(--codex-muted)]">
                        <FolderOpen className="h-4 w-4" />
                        {selectedProject.name}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      className="rounded-full border border-[var(--codex-border)] bg-[#faf8f3]"
                      onClick={openSelectedChat}
                    >
                      {secureWorkspaceActionLabel}
                      <ArrowUpRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button
                      className="rounded-full bg-[var(--codex-accent)] px-5 text-white hover:bg-[var(--codex-accent)]/90"
                      onClick={() => void handleLaunch()}
                      disabled={isAuthenticated ? isLaunching || !draft.trim() : false}
                      data-testid="codex-launch-run"
                    >
                      {isAuthenticated && isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : isAuthenticated ? <Rocket className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                      {launchActionLabel}
                      <Send className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--codex-muted)]">
                <div className="flex flex-wrap items-center gap-4">
                  <span>Local</span>
                  <span>{isAuthenticated ? "Acceso completo" : "Vista previa"}</span>
                  <span>{multiAgentEnabled ? `Multi-agent x${maxSubagents}` : "Single-agent"}</span>
                  <span>{marathonMode ? "Ventana 12h" : "Ventana estándar"}</span>
                  <span>
                    {chatsLoading || projectsLoading || isBranchLoading
                      ? "Sincronizando…"
                      : isAuthenticated
                        ? "Workspace listo"
                        : "Preview listo"}
                  </span>
                </div>

                <Popover open={isBranchMenuOpen} onOpenChange={setIsBranchMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!isAuthenticated}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/88 px-4 py-2 text-sm text-[var(--codex-ink)] shadow-sm transition-colors hover:bg-white"
                      data-testid="codex-branch-trigger"
                    >
                      <GitBranch className="h-4 w-4 text-[var(--codex-muted)]" />
                      <span>{branchButtonLabel}</span>
                      <ChevronDown className="h-4 w-4 text-[var(--codex-muted)]" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="top" className="w-[23rem] overflow-hidden rounded-[30px] p-0">
                    <div className="border-b border-[var(--codex-border)] p-4">
                      <div className="flex items-center gap-3 rounded-2xl border border-[var(--codex-border)] bg-[#fbfaf6] px-3 py-2">
                        <Search className="h-4 w-4 text-[var(--codex-muted)]" />
                        <Input
                          value={branchQuery}
                          onChange={(event) => setBranchQuery(event.target.value)}
                          placeholder="Buscar ramas"
                          className="h-auto border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
                        />
                      </div>
                    </div>

                    <div className="px-5 pt-4 text-xs uppercase tracking-[0.2em] text-[var(--codex-muted)]">Ramas</div>
                    <ScrollArea className="max-h-[22rem] px-2 pb-3 pt-2">
                      <div className="space-y-1 px-2">
                        {filteredBranches.length > 0 ? (
                          filteredBranches.map((branch) => {
                            const isActive = branch === activeRepoBranch;
                            return (
                              <button
                                key={branch}
                                type="button"
                                onClick={() => void handleSelectBranch(branch)}
                                disabled={isBranchActionLoading}
                                className={cn(
                                  "flex w-full items-start justify-between gap-3 rounded-[22px] px-4 py-3 text-left transition-colors hover:bg-[#f7f5ef]",
                                  isActive && "bg-[#f7f5ef]",
                                  isBranchActionLoading && "cursor-wait opacity-70",
                                )}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-3">
                                    <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-[var(--codex-muted)]" />
                                    <p className="truncate text-base font-medium">{branch}</p>
                                  </div>
                                  <p className="mt-2 pl-7 text-sm leading-6 text-[var(--codex-muted)]">
                                    {isActive ? branchSummary?.label || "Sin cambios pendientes" : "Cambiar a esta rama"}
                                  </p>
                                </div>
                                {isActive ? <Check className="mt-1 h-5 w-5 shrink-0 text-[var(--codex-accent)]" /> : null}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-4 py-8 text-sm text-[var(--codex-muted)]">
                            No encontré ramas que coincidan con “{branchQuery}”.
                          </div>
                        )}
                      </div>
                    </ScrollArea>

                    <div className="border-t border-[var(--codex-border)] p-3">
                      <button
                        type="button"
                        onClick={() => {
                          setIsBranchMenuOpen(false);
                          setIsCreateBranchDialogOpen(true);
                        }}
                        className="flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left text-base transition-colors hover:bg-[#f7f5ef]"
                      >
                        <Plus className="h-5 w-5 text-[var(--codex-ink)]" />
                        Crear y cambiar a una rama nueva...
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          </>
          )}
        </main>
      </div>

      <PromptDialog
        open={isCreateBranchDialogOpen}
        onOpenChange={setIsCreateBranchDialogOpen}
        title="Crear y cambiar a una rama nueva"
        description="La rama se crea en el repositorio activo y queda seleccionada de inmediato dentro de OpenClaw."
        label="Nombre de la rama"
        placeholder="openclaw/nueva-tarea-20260322"
        confirmText="Crear rama"
        validate={validateBranchName}
        onConfirm={handleCreateBranch}
      />
    </div>
  );
}
