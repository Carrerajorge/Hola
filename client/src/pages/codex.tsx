import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderTree,
  GitBranch,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AgentTraceViewer } from "@/components/agent/AgentTraceViewer";
import { MonacoCodeEditor } from "@/components/monaco-code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAgentMode, type AgentWorkspaceContext } from "@/hooks/use-agent-mode";
import { useProjects } from "@/hooks/use-projects";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

type CodingAgentProfile = AgentWorkspaceContext["codingAgents"][number];

type RepoTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: RepoTreeNode[];
};

type RepoTreeResponse = {
  success: boolean;
  rootPath: string;
  folderPath: string;
  count: number;
  truncated: boolean;
  nodes: RepoTreeNode[];
};

type RepoFileResponse = {
  success: boolean;
  rootPath: string;
  filePath: string;
  absolutePath: string;
  content: string;
  size: number;
  updatedAt: string;
};

type RepoCommandResponse = {
  success: boolean;
  ok: boolean;
  rootPath: string;
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
};

const CODING_AGENT_OPTIONS: Array<{ id: CodingAgentProfile; label: string }> = [
  { id: "coder", label: "Coder" },
  { id: "reviewer", label: "Reviewer" },
  { id: "improver", label: "Improver" },
];

const MODEL_PRESETS = [
  { label: "Auto", value: "" },
  { label: "GPT-5.3 Codex", value: "openai-codex/gpt-5.3-codex" },
  { label: "GPT-5.1 Codex", value: "openai/gpt-5.1-codex" },
];

const PROMPT_TEMPLATES = [
  "Inspecciona este repo, encuentra el bug principal, arréglalo y deja pruebas.",
  "Implementa la feature pedida, edita los archivos necesarios y valida con los tests relevantes.",
  "Haz un code review del módulo abierto, detecta riesgos y propón el diff mínimo.",
];

const COMMAND_PRESETS = [
  "git status --short --branch",
  "npm run lint",
  "npm test",
  "pnpm test",
];

const STORAGE_KEYS = {
  repoPath: "codex:repo-path",
  selectedFolder: "codex:selected-folder",
  selectedProjectId: "codex:selected-project-id",
  lastChatId: "codex:last-chat-id",
  model: "codex:model",
  command: "codex:last-command",
};

function formatBytes(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Sin registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin registro";
  return date.toLocaleString();
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function inferLanguageFromPath(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  const languageByExtension: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    sql: "sql",
    xml: "xml",
    env: "shell",
  };
  return languageByExtension[extension] || "plaintext";
}

function flattenFilePaths(nodes: RepoTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "file") return [node.path];
    return flattenFilePaths(node.children || []);
  });
}

function findFirstFile(nodes: RepoTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    const nested = findFirstFile(node.children || []);
    if (nested) return nested;
  }
  return null;
}

function formatCommandResult(result: RepoCommandResponse | null): string {
  if (!result) return "Todavia no hay salida.";
  const parts = [`$ ${result.command}`, `cwd: ${result.cwd}`];
  if (result.stdout.trim()) parts.push("", result.stdout.trimEnd());
  if (result.stderr.trim()) parts.push("", "[stderr]", result.stderr.trimEnd());
  parts.push(
    "",
    `exit_code=${result.exitCode}${result.timedOut ? " timeout" : ""}${result.truncated ? " truncated" : ""}`,
  );
  return parts.join("\n");
}

async function fetchJson<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const response = await apiFetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
  }
  return payload as T;
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status === "succeeded" ? "completed" : status;
  const palette =
    normalizedStatus === "completed"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
      : normalizedStatus === "failed" || normalizedStatus === "cancelled"
        ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
        : normalizedStatus === "awaiting_confirmation"
          ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
          : "border-cyan-400/40 bg-cyan-500/10 text-cyan-100";

  return (
    <Badge variant="outline" className={palette}>
      {normalizedStatus.replace(/_/g, " ")}
    </Badge>
  );
}

function FileTreeNodeItem({
  node,
  depth = 0,
  selectedFilePath,
  onSelectFile,
}: {
  node: RepoTreeNode;
  depth?: number;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(depth < 1);
  const hasChildren = (node.children?.length || 0) > 0;

  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
          selectedFilePath === node.path
            ? "bg-cyan-500/15 text-white"
            : "text-zinc-300 hover:bg-white/5 hover:text-white",
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <FileCode2 className="h-4 w-4 shrink-0 text-cyan-300" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-200 transition hover:bg-white/5"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 transition", isOpen && "rotate-90")} />
        <Folder className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="truncate">{node.name}</span>
      </button>

      {isOpen && hasChildren ? (
        <div className="space-y-1">
          {node.children?.map((child) => (
            <FileTreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function CodexPage() {
  const [, setLocation] = useLocation();
  const { projects } = useProjects();
  const repoProjects = useMemo(
    () => projects.filter((project) => typeof project.repositoryPath === "string" && project.repositoryPath.trim().length > 0),
    [projects],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.selectedProjectId) || "";
  });
  const [repoPathInput, setRepoPathInput] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.repoPath) || "";
  });
  const [activeRootPath, setActiveRootPath] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.repoPath) || "";
  });
  const [selectedFolder, setSelectedFolder] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.selectedFolder) || ".";
  });
  const [repoFolders, setRepoFolders] = useState<string[]>([]);
  const [repoBranches, setRepoBranches] = useState<string[]>(["main"]);
  const [activeBranch, setActiveBranch] = useState("main");
  const [codingAgents, setCodingAgents] = useState<CodingAgentProfile[]>(["coder"]);
  const [runtimeTarget] = useState("Local");
  const [executionAccess] = useState("Full access");

  const [treeNodes, setTreeNodes] = useState<RepoTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [fileMeta, setFileMeta] = useState<{ size: number; updatedAt: string; absolutePath: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [commandInput, setCommandInput] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.command) || "git status --short --branch";
  });
  const [commandResult, setCommandResult] = useState<RepoCommandResponse | null>(null);
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const [diffOutput, setDiffOutput] = useState<string>("Selecciona un archivo para ver el diff.");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.model) || "");
  const [chatId, setChatId] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.lastChatId) || "");

  const selectedProject = useMemo(
    () => repoProjects.find((project) => project.id === selectedProjectId) || null,
    [repoProjects, selectedProjectId],
  );

  const workspaceContext = useMemo<AgentWorkspaceContext | undefined>(() => {
    const repositoryPath = activeRootPath.trim();
    if (!repositoryPath) return undefined;
    return {
      projectId: selectedProject?.id,
      projectName: selectedProject?.name,
      repositoryPath,
      selectedFolder: selectedFolder || ".",
      codingAgents,
      runtimeTarget,
      executionAccess,
      branch: activeBranch || undefined,
    };
  }, [
    activeBranch,
    activeRootPath,
    codingAgents,
    executionAccess,
    runtimeTarget,
    selectedFolder,
    selectedProject?.id,
    selectedProject?.name,
  ]);

  const {
    runId,
    status,
    plan,
    steps,
    artifacts,
    summary,
    error,
    progress,
    createdChatId,
    todoList,
    workspaceFiles,
    startRun,
    cancelRun,
    pauseRun,
    resumeRun,
    confirmRun,
    retryRun,
    reset,
    isRunning,
    isCancellable,
  } = useAgentMode(chatId || "");

  const isDirty = Boolean(selectedFilePath) && draftContent !== savedContent;
  const explorerFilePaths = useMemo(() => flattenFilePaths(treeNodes), [treeNodes]);
  const currentChatId = createdChatId || chatId;

  const loadRepositoryCatalog = useCallback(async (rootPath: string) => {
    if (!rootPath.trim()) {
      setRepoFolders([]);
      setRepoBranches(["main"]);
      setActiveBranch("main");
      return;
    }

    const rootQuery = encodeURIComponent(rootPath);
    const [foldersData, branchesData] = await Promise.all([
      fetchJson<{ folders: string[] }>(`/api/local/repo/folders?rootPath=${rootQuery}&maxDepth=5&maxEntries=1200`),
      fetchJson<{ branches: string[]; current: string | null; isGitRepo: boolean }>(
        `/api/local/repo/branches?rootPath=${rootQuery}`,
      ),
    ]);

    const folders = Array.isArray(foldersData.folders) ? foldersData.folders : [];
    const branches = Array.isArray(branchesData.branches) && branchesData.branches.length > 0
      ? branchesData.branches
      : ["main"];

    setRepoFolders(folders);
    setRepoBranches(branches);
    setActiveBranch((current) => {
      if (branchesData.current && branches.includes(branchesData.current)) return branchesData.current;
      if (branches.includes(current)) return current;
      return branches[0] || "main";
    });
    setSelectedFolder((current) => {
      if (current === "." || folders.includes(current)) return current;
      const preferred = selectedProject?.defaultCodeFolder?.trim() || ".";
      return preferred === "." || folders.includes(preferred) ? preferred : ".";
    });
  }, [selectedProject?.defaultCodeFolder]);

  const loadRepositoryTree = useCallback(async (rootPath: string, folderPath: string) => {
    if (!rootPath.trim()) {
      setTreeNodes([]);
      return;
    }

    setTreeLoading(true);
    setTreeError(null);
    try {
      const rootQuery = encodeURIComponent(rootPath);
      const folderQuery = encodeURIComponent(folderPath || ".");
      const payload = await fetchJson<RepoTreeResponse>(
        `/api/local/repo/tree?rootPath=${rootQuery}&folderPath=${folderQuery}&maxDepth=6&maxEntries=2500`,
      );
      setTreeNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo cargar el arbol";
      setTreeError(message);
      setTreeNodes([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (rootPath: string, filePath: string) => {
    if (!rootPath.trim() || !filePath.trim()) return;

    setFileLoading(true);
    setFileError(null);
    try {
      const rootQuery = encodeURIComponent(rootPath);
      const fileQuery = encodeURIComponent(filePath);
      const payload = await fetchJson<RepoFileResponse>(
        `/api/local/repo/file?rootPath=${rootQuery}&filePath=${fileQuery}`,
      );
      setSavedContent(payload.content);
      setDraftContent(payload.content);
      setFileMeta({
        size: payload.size,
        updatedAt: payload.updatedAt,
        absolutePath: payload.absolutePath,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo abrir el archivo";
      setFileError(message);
      setSavedContent("");
      setDraftContent("");
      setFileMeta(null);
    } finally {
      setFileLoading(false);
    }
  }, []);

  const runRepositoryCommand = useCallback(async (commandOverride?: string): Promise<RepoCommandResponse | null> => {
    if (!activeRootPath.trim()) {
      toast.error("Conecta un repositorio primero.");
      return null;
    }

    const command = (commandOverride || commandInput).trim();
    if (!command) {
      toast.error("Escribe un comando para ejecutar.");
      return null;
    }

    setCommandLoading(true);
    setCommandError(null);
    localStorage.setItem(STORAGE_KEYS.command, command);
    if (commandOverride) {
      setCommandInput(command);
    }

    try {
      const payload = await fetchJson<RepoCommandResponse>("/api/local/repo/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootPath: activeRootPath,
          cwd: selectedFolder || ".",
          command,
          timeoutMs: 30_000,
        }),
        timeoutMs: 35_000,
      });
      setCommandResult(payload);
      return payload;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo ejecutar el comando";
      setCommandError(message);
      setCommandResult(null);
      return null;
    } finally {
      setCommandLoading(false);
    }
  }, [activeRootPath, commandInput, selectedFolder]);

  const refreshDiff = useCallback(async (filePath?: string | null) => {
    if (!activeRootPath.trim() || !filePath) {
      setDiffOutput("Selecciona un archivo para ver el diff.");
      setDiffError(null);
      return;
    }

    setDiffLoading(true);
    setDiffError(null);
    try {
      const payload = await fetchJson<RepoCommandResponse>("/api/local/repo/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootPath: activeRootPath,
          cwd: ".",
          command: `git diff -- ${shellQuote(filePath)}`,
          timeoutMs: 20_000,
        }),
      });
      const nextOutput = [payload.stdout, payload.stderr].filter(Boolean).join("\n").trim();
      setDiffOutput(nextOutput || `Sin cambios locales para ${filePath}.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo calcular el diff";
      setDiffError(message);
      setDiffOutput("No se pudo calcular el diff para este archivo.");
    } finally {
      setDiffLoading(false);
    }
  }, [activeRootPath]);

  const saveFile = useCallback(async (nextContent?: string, silent = false) => {
    if (!activeRootPath.trim() || !selectedFilePath) {
      toast.error("No hay archivo seleccionado.");
      return false;
    }

    const contentToSave = typeof nextContent === "string" ? nextContent : draftContent;
    try {
      const payload = await fetchJson<RepoFileResponse>("/api/local/repo/file", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootPath: activeRootPath,
          filePath: selectedFilePath,
          content: contentToSave,
        }),
        timeoutMs: 20_000,
      });
      setSavedContent(contentToSave);
      setDraftContent(contentToSave);
      setFileMeta({
        size: payload.size,
        updatedAt: payload.updatedAt,
        absolutePath: payload.absolutePath,
      });
      if (!silent) {
        toast.success(`Guardado: ${selectedFilePath}`);
      }
      void refreshDiff(selectedFilePath);
      void runRepositoryCommand("git status --short --branch");
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo guardar el archivo");
      return false;
    }
  }, [activeRootPath, draftContent, refreshDiff, runRepositoryCommand, selectedFilePath]);

  const handleSelectFile = useCallback((filePath: string) => {
    if (selectedFilePath === filePath) return;
    if (isDirty && !window.confirm("Hay cambios sin guardar. Se descartaran si abres otro archivo. Continuar?")) {
      return;
    }
    setSelectedFilePath(filePath);
  }, [isDirty, selectedFilePath]);

  const handleConnectRepository = useCallback(() => {
    const nextPath = repoPathInput.trim();
    if (!nextPath) {
      toast.error("Indica una ruta de repositorio.");
      return;
    }
    if (nextPath === activeRootPath) {
      void loadRepositoryCatalog(nextPath);
      void loadRepositoryTree(nextPath, selectedFolder);
      void runRepositoryCommand("git status --short --branch");
      return;
    }
    if (isDirty && !window.confirm("Hay cambios sin guardar. Se descartaran al cambiar de repo. Continuar?")) {
      return;
    }
    setActiveRootPath(nextPath);
    setSelectedFilePath(null);
    setSavedContent("");
    setDraftContent("");
    setFileMeta(null);
    setCommandResult(null);
    setCommandError(null);
    setDiffOutput("Selecciona un archivo para ver el diff.");
    setDiffError(null);
  }, [
    activeRootPath,
    isDirty,
    loadRepositoryCatalog,
    loadRepositoryTree,
    repoPathInput,
    runRepositoryCommand,
    selectedFolder,
  ]);

  const handleSelectProject = useCallback((projectId: string) => {
    const project = repoProjects.find((candidate) => candidate.id === projectId);
    if (isDirty && project?.repositoryPath && !window.confirm("Hay cambios sin guardar. Se descartaran al cambiar de proyecto. Continuar?")) {
      return;
    }

    setSelectedProjectId(projectId);
    localStorage.setItem(STORAGE_KEYS.selectedProjectId, projectId);
    if (!project?.repositoryPath) return;

    const nextRepoPath = project.repositoryPath.trim();
    setRepoPathInput(nextRepoPath);
    setActiveRootPath(nextRepoPath);
    setSelectedFolder(project.defaultCodeFolder?.trim() || ".");
    setCodingAgents(
      Array.isArray(project.codingAgents) && project.codingAgents.length > 0
        ? project.codingAgents
        : ["coder"],
    );
    setSelectedFilePath(null);
    setSavedContent("");
    setDraftContent("");
    setFileMeta(null);
  }, [isDirty, repoProjects]);

  const handleCreateFile = useCallback(async () => {
    if (!activeRootPath.trim()) {
      toast.error("Conecta un repositorio primero.");
      return;
    }

    const suggestedPath = selectedFolder === "." ? "src/new-file.ts" : `${selectedFolder}/new-file.ts`;
    const filePath = window.prompt("Ruta relativa del nuevo archivo", suggestedPath)?.trim();
    if (!filePath) return;

    try {
      await fetchJson<RepoFileResponse>("/api/local/repo/file", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rootPath: activeRootPath,
          filePath,
          content: "",
        }),
      });
      await loadRepositoryTree(activeRootPath, selectedFolder);
      setSelectedFilePath(filePath);
      toast.success(`Archivo creado: ${filePath}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo crear el archivo");
    }
  }, [activeRootPath, loadRepositoryTree, selectedFolder]);

  const handleStartRun = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Describe la tarea que Codex debe ejecutar.");
      return;
    }
    if (!workspaceContext) {
      toast.error("Conecta un repositorio antes de iniciar el agente.");
      return;
    }

    try {
      const result = await startRun(prompt, undefined, {
        model: model.trim() || undefined,
        workspaceContext,
      });
      setChatId(result.chatId);
      localStorage.setItem(STORAGE_KEYS.lastChatId, result.chatId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo iniciar el run");
    }
  }, [model, prompt, startRun, workspaceContext]);

  const handleResetSession = useCallback(() => {
    if (isRunning && !window.confirm("Hay un run activo. Reiniciar la sesion de todos modos?")) {
      return;
    }
    reset();
    setChatId("");
    localStorage.removeItem(STORAGE_KEYS.lastChatId);
  }, [isRunning, reset]);

  useEffect(() => {
    if (!selectedProjectId && repoProjects.length > 0) {
      const storedId = localStorage.getItem(STORAGE_KEYS.selectedProjectId);
      const nextProject = repoProjects.find((project) => project.id === storedId) || repoProjects[0];
      setSelectedProjectId(nextProject.id);
      if (!activeRootPath && nextProject.repositoryPath) {
        setRepoPathInput(nextProject.repositoryPath);
        setActiveRootPath(nextProject.repositoryPath);
        setSelectedFolder(nextProject.defaultCodeFolder?.trim() || ".");
        setCodingAgents(
          Array.isArray(nextProject.codingAgents) && nextProject.codingAgents.length > 0
            ? nextProject.codingAgents
            : ["coder"],
        );
      }
    }
  }, [activeRootPath, repoProjects, selectedProjectId]);

  useEffect(() => {
    if (!activeRootPath.trim()) return;
    localStorage.setItem(STORAGE_KEYS.repoPath, activeRootPath);
    setRepoPathInput(activeRootPath);
    let cancelled = false;

    const syncRepository = async () => {
      try {
        await loadRepositoryCatalog(activeRootPath);
        const payload = await fetchJson<RepoCommandResponse>("/api/local/repo/command", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rootPath: activeRootPath,
            cwd: ".",
            command: "git status --short --branch",
            timeoutMs: 30_000,
          }),
          timeoutMs: 35_000,
        });

        if (!cancelled) {
          setCommandResult(payload);
          setCommandError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          toast.error(cause instanceof Error ? cause.message : "No se pudo conectar el repositorio");
        }
      }
    };

    void syncRepository();

    return () => {
      cancelled = true;
    };
  }, [activeRootPath, loadRepositoryCatalog]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedFolder, selectedFolder);
  }, [selectedFolder]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.model, model);
  }, [model]);

  useEffect(() => {
    if (!activeRootPath.trim()) return;
    void loadRepositoryTree(activeRootPath, selectedFolder);
  }, [activeRootPath, loadRepositoryTree, selectedFolder]);

  useEffect(() => {
    if (!selectedFilePath || !activeRootPath.trim()) return;
    void loadFile(activeRootPath, selectedFilePath);
    void refreshDiff(selectedFilePath);
  }, [activeRootPath, loadFile, refreshDiff, selectedFilePath]);

  useEffect(() => {
    if (treeNodes.length === 0) return;
    if (selectedFilePath && explorerFilePaths.includes(selectedFilePath)) return;
    if (isDirty) return;

    const firstFile = findFirstFile(treeNodes);
    if (firstFile) {
      setSelectedFilePath(firstFile);
    }
  }, [explorerFilePaths, isDirty, selectedFilePath, treeNodes]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_26%),radial-gradient(circle_at_left,rgba(14,116,144,0.16),transparent_30%),linear-gradient(180deg,#050816_0%,#071123_55%,#020617_100%)] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col px-4 py-4 md:px-6">
        <header className="mb-4 flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
          <Button
            variant="ghost"
            className="gap-2 text-zinc-200 hover:bg-white/10 hover:text-white"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-cyan-400/40 bg-cyan-500/10 text-cyan-100">
                Codex Workspace
              </Badge>
              {activeRootPath ? (
                <>
                  <Badge variant="outline" className="border-white/10 text-zinc-200">
                    Repo conectado
                  </Badge>
                  <Badge variant="outline" className="border-white/10 text-zinc-200">
                    <GitBranch className="mr-1 h-3.5 w-3.5" />
                    {activeBranch}
                  </Badge>
                  <Badge variant="outline" className="border-white/10 text-zinc-200">
                    Carpeta {selectedFolder}
                  </Badge>
                </>
              ) : null}
              <StatusBadge status={status} />
              {isDirty ? (
                <Badge variant="outline" className="border-amber-400/40 bg-amber-500/10 text-amber-100">
                  Cambios sin guardar
                </Badge>
              ) : null}
            </div>

            <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">
              Programa dentro del software.
            </h1>
            <p className="mt-1 text-sm text-zinc-300 md:text-base">
              Repo real, editor Monaco, terminal y un agente tipo Codex trabajando sobre tu proyecto.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentChatId ? (
              <Button variant="outline" className="gap-2 border-white/10 bg-white/5" onClick={() => setLocation(`/chat/${currentChatId}`)}>
                <ExternalLink className="h-4 w-4" />
                Abrir chat
              </Button>
            ) : null}
            <Button variant="outline" className="gap-2 border-white/10 bg-white/5" onClick={() => void runRepositoryCommand("git status --short --branch")}>
              <RefreshCw className={cn("h-4 w-4", commandLoading && "animate-spin")} />
              Refrescar estado
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <PanelGroup direction="horizontal" className="h-[calc(100vh-152px)] rounded-3xl border border-white/10 bg-black/20">
            <Panel defaultSize={22} minSize={18}>
              <div className="h-full p-3">
                <Card className="flex h-full flex-col border-white/10 bg-slate-950/55 shadow-none">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-white">
                      <FolderTree className="h-5 w-5 text-cyan-300" />
                      Workspace
                    </CardTitle>
                    <CardDescription className="text-zinc-300">
                      Selecciona el repo, la carpeta activa y los archivos a editar.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                        Proyecto guardado
                      </label>
                      <select
                        value={selectedProjectId}
                        onChange={(event) => handleSelectProject(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                      >
                        <option value="">Seleccionar proyecto</option>
                        {repoProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                        Ruta del repositorio
                      </label>
                      <div className="flex gap-2">
                        <Input
                          value={repoPathInput}
                          onChange={(event) => setRepoPathInput(event.target.value)}
                          placeholder="/Users/luis/Desktop/Hola"
                          className="border-white/10 bg-white/5 text-zinc-100 placeholder:text-zinc-500"
                        />
                        <Button className="shrink-0 bg-cyan-500 text-slate-950 hover:bg-cyan-400" onClick={handleConnectRepository}>
                          Conectar
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                          Carpeta activa
                        </label>
                        <select
                          value={selectedFolder}
                          onChange={(event) => setSelectedFolder(event.target.value)}
                          className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                        >
                          <option value=".">.</option>
                          {repoFolders.map((folder) => (
                            <option key={folder} value={folder}>
                              {folder}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                          Branch
                        </label>
                        <select
                          value={activeBranch}
                          onChange={(event) => setActiveBranch(event.target.value)}
                          className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/50"
                        >
                          {repoBranches.map((branch) => (
                            <option key={branch} value={branch}>
                              {branch}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
                        Perfiles del agente
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {CODING_AGENT_OPTIONS.map((agent) => {
                          const active = codingAgents.includes(agent.id);
                          return (
                            <button
                              key={agent.id}
                              type="button"
                              onClick={() => {
                                setCodingAgents((current) => {
                                  const exists = current.includes(agent.id);
                                  const next = exists ? current.filter((value) => value !== agent.id) : [...current, agent.id];
                                  return next.length > 0 ? next : ["coder"];
                                });
                              }}
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                active
                                  ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                                  : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white",
                              )}
                            >
                              {agent.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <Separator className="bg-white/10" />

                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">Explorer</p>
                        <p className="text-xs text-zinc-400">
                          {explorerFilePaths.length} archivos visibles
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-2 border-white/10 bg-white/5" onClick={() => void loadRepositoryTree(activeRootPath, selectedFolder)}>
                          <RefreshCw className={cn("h-4 w-4", treeLoading && "animate-spin")} />
                          Sync
                        </Button>
                        <Button variant="outline" size="sm" className="gap-2 border-white/10 bg-white/5" onClick={() => void handleCreateFile()}>
                          <FilePlus2 className="h-4 w-4" />
                          Nuevo
                        </Button>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                      {!activeRootPath ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
                          Conecta un repositorio para navegar y editar archivos.
                        </div>
                      ) : treeError ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rose-200">
                          {treeError}
                        </div>
                      ) : treeLoading ? (
                        <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-300">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Cargando arbol...
                        </div>
                      ) : (
                        <ScrollArea className="h-full">
                          <div className="space-y-1 p-2">
                            {treeNodes.length > 0 ? (
                              treeNodes.map((node) => (
                                <FileTreeNodeItem
                                  key={node.path}
                                  node={node}
                                  selectedFilePath={selectedFilePath}
                                  onSelectFile={handleSelectFile}
                                />
                              ))
                            ) : (
                              <div className="px-3 py-6 text-center text-sm text-zinc-400">
                                No se encontraron archivos para esta carpeta.
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </Panel>

            <PanelResizeHandle className="w-1 bg-white/5 transition hover:bg-cyan-400/30" />

            <Panel defaultSize={46} minSize={34}>
              <div className="h-full p-3">
                <PanelGroup direction="vertical" className="h-full">
                  <Panel defaultSize={68} minSize={48}>
                    <Card className="flex h-full flex-col border-white/10 bg-slate-950/55 shadow-none">
                      <CardHeader className="pb-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-white">
                              <FileCode2 className="h-5 w-5 text-cyan-300" />
                              {selectedFilePath || "Editor"}
                            </CardTitle>
                            <CardDescription className="mt-1 text-zinc-300">
                              {fileMeta
                                ? `${formatBytes(fileMeta.size)} · actualizado ${formatDateTime(fileMeta.updatedAt)}`
                                : activeRootPath
                                  ? "Selecciona un archivo para empezar."
                                  : "Conecta un repositorio para habilitar el editor."}
                            </CardDescription>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {fileMeta?.absolutePath ? (
                              <Badge variant="outline" className="border-white/10 text-zinc-200">
                                {fileMeta.absolutePath}
                              </Badge>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2 border-white/10 bg-white/5"
                              disabled={!selectedFilePath || fileLoading}
                              onClick={() => selectedFilePath && void loadFile(activeRootPath, selectedFilePath)}
                            >
                              <RefreshCw className={cn("h-4 w-4", fileLoading && "animate-spin")} />
                              Recargar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2 border-white/10 bg-white/5"
                              disabled={!selectedFilePath || !isDirty}
                              onClick={() => {
                                setDraftContent(savedContent);
                                toast.success("Cambios locales descartados.");
                              }}
                            >
                              <RotateCcw className="h-4 w-4" />
                              Revertir
                            </Button>
                            <Button
                              size="sm"
                              className="gap-2 bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                              disabled={!selectedFilePath || !isDirty}
                              onClick={() => void saveFile()}
                            >
                              <Save className="h-4 w-4" />
                              Guardar
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="min-h-0 flex-1">
                        {!activeRootPath ? (
                          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-8 text-center text-sm text-zinc-400">
                            Esta vista funciona como un IDE embebido. Conecta un repo y abre un archivo para empezar a programar dentro del software.
                          </div>
                        ) : fileError ? (
                          <div className="flex h-full items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 px-8 text-center text-sm text-rose-100">
                            {fileError}
                          </div>
                        ) : selectedFilePath ? (
                          <div className="h-full min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                            <MonacoCodeEditor
                              code={draftContent}
                              language={inferLanguageFromPath(selectedFilePath)}
                              height="100%"
                              theme="dark"
                              showMinimap
                              onChange={setDraftContent}
                              onSave={(value) => {
                                void saveFile(value, true);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-8 text-center text-sm text-zinc-400">
                            Selecciona un archivo en el explorer para abrirlo en Monaco.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </Panel>

                  <PanelResizeHandle className="h-1 bg-white/5 transition hover:bg-cyan-400/30" />

                  <Panel defaultSize={32} minSize={24}>
                    <Card className="flex h-full flex-col border-white/10 bg-slate-950/55 shadow-none">
                      <CardHeader className="pb-4">
                        <CardTitle className="flex items-center gap-2 text-white">
                          <Terminal className="h-5 w-5 text-cyan-300" />
                          Terminal y Git
                        </CardTitle>
                        <CardDescription className="text-zinc-300">
                          Ejecuta comandos sobre el repo activo y revisa el diff del archivo abierto.
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="min-h-0 flex-1">
                        <Tabs defaultValue="terminal" className="flex h-full flex-col">
                          <TabsList className="grid w-full grid-cols-2 bg-white/5">
                            <TabsTrigger value="terminal">Terminal</TabsTrigger>
                            <TabsTrigger value="diff">Git Diff</TabsTrigger>
                          </TabsList>

                          <TabsContent value="terminal" className="mt-4 min-h-0 flex-1">
                            <div className="mb-3 flex flex-wrap gap-2">
                              {COMMAND_PRESETS.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => void runRepositoryCommand(preset)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>

                            <div className="mb-3 flex gap-2">
                              <Input
                                value={commandInput}
                                onChange={(event) => setCommandInput(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void runRepositoryCommand();
                                  }
                                }}
                                placeholder="git status --short --branch"
                                className="border-white/10 bg-white/5 text-zinc-100"
                              />
                              <Button
                                className="gap-2 bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                                disabled={commandLoading || !activeRootPath}
                                onClick={() => void runRepositoryCommand()}
                              >
                                {commandLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                                Ejecutar
                              </Button>
                            </div>

                            <div className="h-[calc(100%-64px)] overflow-hidden rounded-2xl border border-white/10 bg-black/50">
                              <ScrollArea className="h-full">
                                <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-zinc-200">
                                  {commandError ? `ERROR\n\n${commandError}` : formatCommandResult(commandResult)}
                                </pre>
                              </ScrollArea>
                            </div>
                          </TabsContent>

                          <TabsContent value="diff" className="mt-4 min-h-0 flex-1">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="text-sm text-zinc-300">
                                {selectedFilePath ? `git diff -- ${selectedFilePath}` : "Sin archivo seleccionado"}
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 border-white/10 bg-white/5"
                                disabled={!selectedFilePath || diffLoading}
                                onClick={() => void refreshDiff(selectedFilePath)}
                              >
                                <RefreshCw className={cn("h-4 w-4", diffLoading && "animate-spin")} />
                                Refrescar diff
                              </Button>
                            </div>

                            <div className="h-[calc(100%-56px)] overflow-hidden rounded-2xl border border-white/10 bg-black/50">
                              <ScrollArea className="h-full">
                                <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-zinc-200">
                                  {diffError ? `ERROR\n\n${diffError}` : diffOutput}
                                </pre>
                              </ScrollArea>
                            </div>
                          </TabsContent>
                        </Tabs>
                      </CardContent>
                    </Card>
                  </Panel>
                </PanelGroup>
              </div>
            </Panel>

            <PanelResizeHandle className="w-1 bg-white/5 transition hover:bg-cyan-400/30" />

            <Panel defaultSize={32} minSize={24}>
              <div className="h-full p-3">
                <Card className="flex h-full flex-col border-white/10 bg-slate-950/55 shadow-none">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Bot className="h-5 w-5 text-cyan-300" />
                      Codex Agent
                    </CardTitle>
                    <CardDescription className="text-zinc-300">
                      Plan visible, ejecucion pausada/reanudable y confirmacion humana para acciones sensibles.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
                    <div className="space-y-3">
                      <Textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="Ejemplo: inspecciona el repo, arregla el bug de auth y valida con tests."
                        className="min-h-[136px] resize-none border-white/10 bg-white/5 text-zinc-100"
                      />

                      <div className="grid gap-3 md:grid-cols-[1fr,auto]">
                        <Input
                          value={model}
                          onChange={(event) => setModel(event.target.value)}
                          placeholder="Modelo opcional"
                          className="border-white/10 bg-white/5 text-zinc-100"
                        />
                        <div className="flex flex-wrap gap-2">
                          {MODEL_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => setModel(preset.value)}
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                model === preset.value
                                  ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                                  : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white",
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {PROMPT_TEMPLATES.map((template) => (
                          <button
                            key={template}
                            type="button"
                            onClick={() => setPrompt(template)}
                            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/10 hover:text-white"
                          >
                            {template}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button className="gap-2 bg-cyan-500 text-slate-950 hover:bg-cyan-400" onClick={() => void handleStartRun()}>
                          <Sparkles className="h-4 w-4" />
                          Ejecutar tarea
                        </Button>
                        <Button variant="outline" className="gap-2 border-white/10 bg-white/5" onClick={handleResetSession}>
                          <RotateCcw className="h-4 w-4" />
                          Nueva sesion
                        </Button>

                        {status === "running" || status === "planning" || status === "queued" || status === "verifying" ? (
                          <Button variant="outline" className="gap-2 border-white/10 bg-white/5" disabled={!isRunning} onClick={() => void pauseRun()}>
                            <Pause className="h-4 w-4" />
                            Pausar
                          </Button>
                        ) : null}

                        {status === "paused" ? (
                          <Button variant="outline" className="gap-2 border-white/10 bg-white/5" onClick={() => void resumeRun()}>
                            <Play className="h-4 w-4" />
                            Reanudar
                          </Button>
                        ) : null}

                        {status === "awaiting_confirmation" ? (
                          <>
                            <Button variant="outline" className="gap-2 border-emerald-400/40 bg-emerald-500/10 text-emerald-100" onClick={() => void confirmRun("confirm")}>
                              <CheckCircle2 className="h-4 w-4" />
                              Confirmar
                            </Button>
                            <Button variant="outline" className="gap-2 border-rose-400/40 bg-rose-500/10 text-rose-100" onClick={() => void confirmRun("cancel")}>
                              <XCircle className="h-4 w-4" />
                              Rechazar
                            </Button>
                          </>
                        ) : null}

                        {isCancellable ? (
                          <Button variant="outline" className="gap-2 border-white/10 bg-white/5" onClick={() => void cancelRun()}>
                            <Square className="h-4 w-4" />
                            Cancelar
                          </Button>
                        ) : null}

                        {(status === "failed" || status === "cancelled" || status === "completed") && runId ? (
                          <Button variant="outline" className="gap-2 border-white/10 bg-white/5" onClick={() => void retryRun()}>
                            <RotateCcw className="h-4 w-4" />
                            Reintentar
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-zinc-300">Progreso del run</span>
                        <span className="text-zinc-400">
                          {progress.current}/{progress.total || steps.length || 0}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-cyan-400 transition-all"
                          style={{
                            width: `${progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : status === "completed" ? 100 : 8}%`,
                          }}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <StatusBadge status={status} />
                        {runId ? <span>Run {runId}</span> : null}
                        {currentChatId ? <span>Chat {currentChatId}</span> : null}
                      </div>
                    </div>

                    <div className="min-h-0 flex-1">
                      <Tabs defaultValue="overview" className="flex h-full flex-col">
                        <TabsList className="grid w-full grid-cols-3 bg-white/5">
                          <TabsTrigger value="overview">Resumen</TabsTrigger>
                          <TabsTrigger value="trace">Trace</TabsTrigger>
                          <TabsTrigger value="workspace">Runtime files</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview" className="mt-4 min-h-0 flex-1">
                          <ScrollArea className="h-full rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="space-y-5">
                              {summary ? (
                                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
                                  {summary}
                                </div>
                              ) : null}

                              {error ? (
                                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                                  {error}
                                </div>
                              ) : null}

                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-white">Todo list</h3>
                                  <span className="text-xs text-zinc-400">{todoList.length} items</span>
                                </div>

                                {todoList.length > 0 ? (
                                  todoList.map((item) => (
                                    <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <p className="text-sm text-white">{item.task}</p>
                                        <StatusBadge status={item.status} />
                                      </div>
                                      {item.lastError ? (
                                        <p className="text-xs text-rose-200">
                                          {typeof item.lastError === "string" ? item.lastError : JSON.stringify(item.lastError)}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))
                                ) : (
                                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
                                    El run todavia no publico tareas.
                                  </div>
                                )}
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-white">Plan y pasos</h3>
                                  <span className="text-xs text-zinc-400">
                                    {plan?.steps.length || steps.length} pasos
                                  </span>
                                </div>

                                {(plan?.steps.length || steps.length) > 0 ? (
                                  (plan?.steps.length
                                    ? plan.steps.map((step) => ({
                                        index: step.index,
                                        toolName: step.toolName,
                                        description: step.description,
                                        liveStep: steps.find((candidate) => candidate.stepIndex === step.index),
                                      }))
                                    : steps.map((step, index) => ({
                                        index,
                                        toolName: step.toolName,
                                        description: step.toolName,
                                        liveStep: step,
                                      }))).map((step) => {
                                    const stepStatus = step.liveStep?.status || "pending";
                                    return (
                                      <div key={`${step.toolName}-${step.index}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                          <div className="text-sm font-medium text-white">
                                            {step.index + 1}. {step.description || step.toolName}
                                          </div>
                                          <StatusBadge status={stepStatus} />
                                        </div>
                                        <div className="text-xs text-zinc-400">
                                          <span className="font-medium text-zinc-300">{step.toolName}</span>
                                        </div>
                                        {step.liveStep?.error ? (
                                          <p className="mt-2 text-xs text-rose-200">{step.liveStep.error}</p>
                                        ) : null}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
                                    Aun no hay plan disponible.
                                  </div>
                                )}
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-white">Artefactos</h3>
                                  <span className="text-xs text-zinc-400">{artifacts.length}</span>
                                </div>

                                {artifacts.length > 0 ? (
                                  artifacts.map((artifact, index) => (
                                    <div key={`${artifact.name}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                      <div className="flex items-center justify-between gap-2">
                                        <div>
                                          <p className="text-sm text-white">{artifact.name}</p>
                                          <p className="text-xs text-zinc-400">{artifact.type}</p>
                                        </div>
                                        {artifact.url ? (
                                          <a
                                            className="text-xs text-cyan-200 underline"
                                            href={artifact.url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Abrir
                                          </a>
                                        ) : null}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
                                    Todavia no se generaron artefactos.
                                  </div>
                                )}
                              </div>
                            </div>
                          </ScrollArea>
                        </TabsContent>

                        <TabsContent value="trace" className="mt-4 min-h-0 flex-1">
                          <div className="h-full overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                            {runId ? (
                              <AgentTraceViewer runId={runId} />
                            ) : (
                              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
                                Inicia un run para seguir la traza viva del agente.
                              </div>
                            )}
                          </div>
                        </TabsContent>

                        <TabsContent value="workspace" className="mt-4 min-h-0 flex-1">
                          <ScrollArea className="h-full rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="space-y-3">
                              {Object.entries(workspaceFiles).length > 0 ? (
                                Object.entries(workspaceFiles).map(([filename, content]) => (
                                  <div key={filename} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
                                      <FileText className="h-4 w-4 text-cyan-300" />
                                      {filename}
                                    </div>
                                    <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300">
                                      {content.length > 2000 ? `${content.slice(0, 2000)}\n\n...truncado` : content}
                                    </pre>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
                                  El runtime todavia no expuso archivos de trabajo. Cuando el agente lea o escriba archivos, apareceran aqui.
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </div>
  );
}
