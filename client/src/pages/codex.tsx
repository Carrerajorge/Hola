import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  AudioLines,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  Command,
  FileCode2,
  FolderOpen,
  GitBranch,
  Layers3,
  Mic,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useChats, type Chat, type Message } from "@/hooks/use-chats";
import { useProjects, type Project } from "@/hooks/use-projects";
import { cn } from "@/lib/utils";

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

const shellStyle: CSSProperties = {
  "--codex-bg": "#f7f5f0",
  "--codex-sidebar": "#f3eee4",
  "--codex-panel": "rgba(255,255,255,0.8)",
  "--codex-border": "rgba(25,23,18,0.12)",
  "--codex-ink": "#171512",
  "--codex-muted": "#726b60",
  "--codex-accent": "#1f7a55",
  "--codex-accent-soft": "rgba(31,122,85,0.12)",
  "--codex-accent-ink": "#174f39",
} as CSSProperties;

const primaryNav = [
  { id: "new", label: "Nueva sesión", icon: Plus },
  { id: "scheduled", label: "Programado", icon: Clock3 },
  { id: "dispatch", label: "Despachar", icon: Layers3 },
  { id: "customize", label: "Personalizar", icon: Settings2 },
] as const;

const quickActions = [
  "Revisar el último cambio",
  "Diseñar una migración segura",
  "Resumir el contexto técnico",
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
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function getSessionStatus(chat: Chat): SessionStatus {
  const lastAssistant = [...chat.messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant) return "waiting";

  if (lastAssistant.agentRun?.status === "processing" || lastAssistant.status === "processing") {
    return "running";
  }

  if (lastAssistant.agentRun?.status === "failed" || lastAssistant.status === "failed") {
    return "waiting";
  }

  return "ready";
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

  if (session.project) {
    const workspaceSummary = [
      session.project.repositoryPath ? `Repositorio: ${session.project.repositoryPath}` : "Workspace local listo",
      session.project.defaultCodeFolder ? `Carpeta base: ${session.project.defaultCodeFolder}` : null,
      session.project.files.length > 0 ? `${session.project.files.length} archivo(s) en contexto` : "Sin archivos extra cargados",
    ]
      .filter(Boolean)
      .join(" · ");

    items.push({
      id: `${session.id}-workspace`,
      title: "Workspace conectado",
      body: workspaceSummary,
      meta: session.updatedLabel,
      tone: "neutral",
      icon: FolderOpen,
    });
  }

  const recentMessages = session.chat.messages
    .filter((message) => message.role !== "system")
    .slice(-4);

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

    if (message.role === "assistant" && Array.isArray(message.agentRun?.steps)) {
      for (const step of message.agentRun.steps.slice(0, 2)) {
        const outputSummary = normalizeText(
          typeof step.output === "string" ? step.output : JSON.stringify(step.output ?? "")
        );
        items.push({
          id: `${message.id}-${step.stepIndex}`,
          title: truncateText(step.toolName || "Acción del agente", 48),
          body: truncateText(outputSummary || "Paso preparado para esta sesión.", 180),
          meta: step.status === "complete" ? "Paso completado" : "Paso registrado",
          tone: step.status === "complete" ? "success" : "neutral",
          icon: FileCode2,
        });
      }
    }
  }

  if (items.length === 0) {
    items.push({
      id: `${session.id}-placeholder`,
      title: "Sesión lista para continuar",
      body: "Codex ya tiene el contexto principal cargado. Puedes abrir el chat y seguir desde el último punto de trabajo.",
      meta: session.updatedLabel,
      tone: "neutral",
      icon: Bot,
    });
  }

  return items.slice(0, 6);
}

export default function CodexPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { allChats, isLoading: chatsLoading } = useChats();
  const { projects, isLoading: projectsLoading } = useProjects();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
        branchLabel: project?.defaultCodeFolder
          ? project.defaultCodeFolder.split(/[\\/]/).filter(Boolean).slice(-1)[0] || "main"
          : "main",
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

  const profileName =
    normalizeText(user?.fullName) ||
    normalizeText(user?.email?.split("@")[0]) ||
    "Admin";

  const composerTarget = selectedSession ? `/chat/${selectedSession.id}` : "/";

  const openSelectedChat = () => {
    setLocation(composerTarget);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      openSelectedChat();
    }
  };

  return (
    <div
      className="min-h-screen bg-[var(--codex-bg)] text-[var(--codex-ink)]"
      style={shellStyle}
      data-testid="codex-page"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[340px] bg-[radial-gradient(circle_at_top,_rgba(210,228,218,0.85),_transparent_62%)]" />
        <div className="absolute left-[-10%] top-[18%] h-72 w-72 rounded-full bg-[rgba(221,210,180,0.22)] blur-3xl" />
      </div>

      <div className="relative flex min-h-screen">
        <aside className="hidden w-[320px] shrink-0 border-r border-[var(--codex-border)] bg-[var(--codex-sidebar)]/95 backdrop-blur-xl md:flex md:flex-col">
          <div className="px-5 pb-4 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-[var(--codex-muted)]">ILIAGPT</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--codex-border)] bg-white/80 shadow-sm">
                    <Code2 className="h-5 w-5 text-[var(--codex-accent)]" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Codex</p>
                    <p className="text-sm text-[var(--codex-muted)]">Workspace técnico dedicado</p>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-[var(--codex-muted)] hover:bg-white/80"
                onClick={() => setLocation("/")}
                aria-label="Volver al chat principal"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="px-3">
            <div className="space-y-1">
              {primaryNav.map((item, index) => {
                const Icon = item.icon;
                const isActive = index === 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/80",
                      isActive && "bg-white/90 shadow-sm",
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
          </div>

          <Separator className="mx-4 my-4 bg-[var(--codex-border)]" />

          <ScrollArea className="flex-1 px-4 pb-4">
            <div className="space-y-7">
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Todos los proyectos</p>
                    <p className="mt-1 text-sm text-[var(--codex-muted)]">Contexto listo para sesiones agenticas</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-white/80">
                      <Search className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-white/80">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {projects.length > 0 ? (
                    projects.slice(0, 6).map((project) => {
                      const isSelected = selectedSession?.project?.id === project.id;
                      return (
                        <button
                          key={project.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between rounded-2xl border border-transparent px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--codex-border)] hover:bg-white/80",
                            isSelected && "border-[var(--codex-border)] bg-white/90 shadow-sm",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{project.name}</p>
                            <p className="mt-1 text-xs text-[var(--codex-muted)]">
                              {project.chatIds.length} sesiones · {project.files.length} archivo(s)
                            </p>
                          </div>
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-white/80"
                            style={{ backgroundColor: project.color }}
                          />
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-3xl border border-dashed border-[var(--codex-border)] px-4 py-5 text-sm text-[var(--codex-muted)]">
                      Tus proyectos aparecerán aquí para abrir sesiones con contexto técnico.
                    </div>
                  )}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Sesiones</p>
                  <span className="text-xs text-[var(--codex-muted)]">{sessions.length} activas</span>
                </div>

                <div className="space-y-5">
                  {groupedSessions.length > 0 ? (
                    groupedSessions.map((group) => (
                      <div key={group.label} className="space-y-2">
                        <p className="px-1 text-xs font-medium text-[var(--codex-muted)]">{group.label}</p>
                        {group.items.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => setSelectedSessionId(session.id)}
                            className={cn(
                              "group flex w-full items-start gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--codex-border)] hover:bg-white/85",
                              selectedSessionId === session.id && "border-[var(--codex-border)] bg-white/92 shadow-sm",
                            )}
                            data-testid={`codex-session-${session.id}`}
                          >
                            <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--codex-accent)]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <p className="truncate text-sm font-medium">{session.title}</p>
                                <span className="text-xs text-[var(--codex-muted)]">{session.timeLabel}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--codex-muted)]">
                                {session.preview || "Sesión lista para retomarse desde Codex."}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-3xl border border-dashed border-[var(--codex-border)] px-4 py-5 text-sm text-[var(--codex-muted)]">
                      Todavía no hay sesiones recientes. Crea una conversación y aquí aparecerá el historial.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </ScrollArea>

          <div className="border-t border-[var(--codex-border)] p-4">
            <div className="flex items-center gap-3 rounded-3xl bg-white/85 px-4 py-3 shadow-sm">
              <Avatar className="h-10 w-10 border border-[var(--codex-border)] bg-[#ebe6d9]">
                <AvatarFallback className="bg-transparent text-sm font-semibold text-[var(--codex-accent-ink)]">
                  {getInitials(profileName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{profileName}</p>
                <p className="truncate text-xs uppercase tracking-[0.2em] text-[var(--codex-muted)]">Cuenta activa</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-[var(--codex-border)] bg-[rgba(247,245,240,0.82)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4 px-4 py-4 md:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full border border-[var(--codex-border)] bg-white/80 md:hidden"
                  onClick={() => setLocation("/")}
                  aria-label="Volver"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--codex-muted)]">Codex workspace</p>
                  <button
                    type="button"
                    className="mt-1 flex max-w-full items-center gap-2 text-left"
                    data-testid="codex-session-title"
                  >
                    <span className="truncate text-xl font-semibold">
                      {selectedSession?.title || "Nueva sesión"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--codex-muted)]" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/80 px-3 py-1.5 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--codex-accent)]" />
                  Vista previa
                </div>
                <Button variant="ghost" size="icon" className="rounded-full border border-[var(--codex-border)] bg-white/80">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="border-t border-[var(--codex-border)] bg-[#f2ead6]/85 px-4 py-3 text-sm text-[#544d40] md:px-6 lg:px-8">
              <span className="font-semibold">Modo de trabajo listo:</span> Codex organiza sesiones, contexto y seguimiento en una superficie dedicada antes de entrar al chat.
            </div>

            <div className="border-t border-[var(--codex-border)] px-4 py-3 md:hidden">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {primaryNav.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <span
                      key={item.id}
                      className={cn(
                        "inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--codex-border)] px-3 py-2 text-sm",
                        index === 0 ? "bg-white/90 shadow-sm" : "bg-[rgba(255,255,255,0.65)]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </span>
                  );
                })}
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-40 pt-8 md:px-6 lg:px-8">
                {selectedSession ? (
                  <>
                    <section className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-8" data-testid="codex-main-panel">
                        <div className="max-w-3xl">
                          <div className="inline-flex items-center gap-2 rounded-full bg-[var(--codex-accent-soft)] px-3 py-1 text-sm font-medium text-[var(--codex-accent-ink)]">
                            <Bot className="h-4 w-4" />
                            Sesión activa
                          </div>
                          <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">
                            {selectedSession.title}
                          </h1>
                          <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--codex-muted)]">
                            {selectedSession.assistantOutput || selectedSession.preview}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/75 px-3 py-2 text-sm">
                            <Clock3 className="h-4 w-4 text-[var(--codex-muted)]" />
                            {selectedSession.updatedLabel}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/75 px-3 py-2 text-sm">
                            <Sparkles className="h-4 w-4 text-[var(--codex-muted)]" />
                            {selectedSession.messageCount} eventos
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/75 px-3 py-2 text-sm">
                            <FileCode2 className="h-4 w-4 text-[var(--codex-muted)]" />
                            {selectedSession.attachmentCount} adjunto(s)
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm",
                              getStatusTone(selectedSession.status),
                            )}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {getStatusLabel(selectedSession.status)}
                          </span>
                        </div>

                        <section className="space-y-5">
                          <div className="flex items-center justify-between border-b border-[var(--codex-border)] pb-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Actividad reciente</p>
                              <p className="mt-1 text-sm text-[var(--codex-muted)]">
                                Trazabilidad clara para retomar el trabajo sin ruido visual.
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              className="rounded-full border border-[var(--codex-border)] bg-white/80 px-4"
                              onClick={openSelectedChat}
                              data-testid="codex-open-chat"
                            >
                              Abrir chat
                            </Button>
                          </div>

                          <div className="space-y-4">
                            {activityItems.map((item) => {
                              const Icon = item.icon;
                              const toneClasses =
                                item.tone === "success"
                                  ? "bg-[#e9f4ee] text-[var(--codex-accent-ink)]"
                                  : item.tone === "accent"
                                    ? "bg-[#f1eadc] text-[#6f5630]"
                                    : "bg-[#f4f0e8] text-[var(--codex-muted)]";

                              return (
                                <article
                                  key={item.id}
                                  className="rounded-[28px] border border-[var(--codex-border)] bg-[var(--codex-panel)] px-5 py-5 shadow-[0_18px_55px_-40px_rgba(23,21,18,0.32)]"
                                >
                                  <div className="flex items-start gap-4">
                                    <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", toneClasses)}>
                                      <Icon className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-3">
                                        <h2 className="text-lg font-semibold">{item.title}</h2>
                                        <span className="text-xs uppercase tracking-[0.18em] text-[var(--codex-muted)]">
                                          {item.meta}
                                        </span>
                                      </div>
                                      <p className="mt-2 text-base leading-7 text-[var(--codex-muted)]">
                                        {item.body}
                                      </p>
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      </div>

                      <aside className="space-y-8 xl:sticky xl:top-6 xl:self-start">
                        <section className="border-b border-[var(--codex-border)] pb-6">
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Workspace activo</p>
                          <div className="mt-4 space-y-4">
                            <div>
                              <p className="text-sm text-[var(--codex-muted)]">Proyecto</p>
                              <p className="mt-1 text-lg font-semibold">
                                {selectedSession.project?.name || "Sesión general"}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm text-[var(--codex-muted)]">Prompt base</p>
                              <p className="mt-1 text-sm leading-7 text-[var(--codex-ink)]">
                                {selectedSession.userPrompt || "Listo para recibir una nueva instrucción técnica."}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div className="rounded-2xl border border-[var(--codex-border)] bg-white/70 px-4 py-3">
                                <p className="text-[var(--codex-muted)]">Archivos</p>
                                <p className="mt-1 text-xl font-semibold">
                                  {selectedSession.project?.files.length || selectedSession.attachmentCount}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-[var(--codex-border)] bg-white/70 px-4 py-3">
                                <p className="text-[var(--codex-muted)]">Rama</p>
                                <p className="mt-1 text-xl font-semibold">{selectedSession.branchLabel}</p>
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="border-b border-[var(--codex-border)] pb-6">
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Estado rápido</p>
                          <div className="mt-4 space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-[var(--codex-muted)]">Sesiones visibles</span>
                              <span className="font-semibold">{sessions.length}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[var(--codex-muted)]">Proyectos</span>
                              <span className="font-semibold">{projects.length}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[var(--codex-muted)]">Última actualización</span>
                              <span className="font-semibold">{selectedSession.updatedLabel}</span>
                            </div>
                          </div>
                        </section>

                        <section className="space-y-3">
                          <p className="text-xs uppercase tracking-[0.22em] text-[var(--codex-muted)]">Atajos</p>
                          <div className="flex flex-wrap gap-2">
                            {quickActions.map((action) => (
                              <span
                                key={action}
                                className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/75 px-3 py-2 text-sm text-[var(--codex-ink)]"
                              >
                                <Sparkles className="h-3.5 w-3.5 text-[var(--codex-accent)]" />
                                {action}
                              </span>
                            ))}
                          </div>
                        </section>
                      </aside>
                    </section>
                  </>
                ) : (
                  <section className="mx-auto flex w-full max-w-4xl flex-col items-center py-12 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-[28px] border border-[var(--codex-border)] bg-white/80 shadow-sm">
                      <Code2 className="h-9 w-9 text-[var(--codex-accent)]" />
                    </div>
                    <h1 className="mt-8 text-4xl font-semibold tracking-tight md:text-5xl">
                      Nueva sesión lista para arrancar
                    </h1>
                    <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--codex-muted)]">
                      Al entrar a Codex verás una superficie dedicada para sesiones técnicas, revisión de contexto y continuidad de trabajo sin depender de un modal.
                    </p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      {quickActions.map((action) => (
                        <span
                          key={action}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] bg-white/75 px-4 py-2 text-sm"
                        >
                          <Sparkles className="h-4 w-4 text-[var(--codex-accent)]" />
                          {action}
                        </span>
                      ))}
                    </div>
                    <Button className="mt-10 rounded-full bg-[var(--codex-accent)] px-6 text-white hover:bg-[var(--codex-accent)]/90" onClick={() => setLocation("/")}>
                      Abrir chat principal
                    </Button>
                  </section>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="sticky bottom-0 border-t border-[var(--codex-border)] bg-[rgba(247,245,240,0.9)] backdrop-blur-xl">
            <div className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4 md:px-6 lg:px-8">
              <div className="rounded-[30px] border border-[var(--codex-border)] bg-white/88 p-2 shadow-[0_20px_60px_-42px_rgba(23,21,18,0.4)]">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Describe la tarea para Codex o usa esta vista para retomar una sesión existente."
                  className="min-h-[78px] resize-none border-0 bg-transparent px-4 py-4 text-base leading-7 shadow-none focus-visible:ring-0"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full border border-[var(--codex-border)] bg-[#faf8f3]">
                      <Plus className="h-4 w-4" />
                    </Button>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--codex-border)] px-3 py-2 text-sm text-[var(--codex-muted)]">
                      <Command className="h-4 w-4" />
                      comandos
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full border border-[var(--codex-border)] bg-[#faf8f3]">
                      <Mic className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full border border-[var(--codex-border)] bg-[#faf8f3]">
                      <AudioLines className="h-4 w-4" />
                    </Button>
                    <Button
                      className="rounded-full bg-[var(--codex-accent)] px-5 text-white hover:bg-[var(--codex-accent)]/90"
                      onClick={openSelectedChat}
                    >
                      Abrir chat
                      <Send className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--codex-muted)]">
                <div className="flex flex-wrap items-center gap-4">
                  <span>Local</span>
                  <span>Full access</span>
                  <span>{chatsLoading || projectsLoading ? "Sincronizando…" : "Workspace listo"}</span>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" />
                  {selectedSession?.branchLabel || "main"}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
