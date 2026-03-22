/**
 * Projects Hook
 * 
 * Manages project folders with full CRUD operations.
 * Persists to localStorage with optional server sync.
 */

import { useState, useEffect, useCallback } from "react";
import type { CreateProjectData, ProjectFile } from "@/components/create-project-modal";

export interface Project {
    id: string;
    name: string;
    color: string;
    backgroundImage: string | null;
    systemPrompt: string;
    repositoryPath?: string | null;
    defaultCodeFolder?: string | null;
    codingAgents?: Array<"coder" | "reviewer" | "improver">;
    files: ProjectFile[];
    chatIds: string[];
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = "iliagpt-projects";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSafeString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

function toSafeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeProjectFile(value: unknown): ProjectFile | null {
    if (!isRecord(value)) return null;

    const id = toSafeString(value.id).trim();
    const name = toSafeString(value.name).trim();
    const type = toSafeString(value.type);
    const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : 0;
    const source = value.source === "upload" || value.source === "knowledge" ? value.source : "upload";

    if (!id || !name) return null;

    return {
        id,
        name,
        type,
        size,
        source,
    };
}

function normalizeProject(raw: unknown): Project | null {
    if (!isRecord(raw)) return null;

    const id = toSafeString(raw.id).trim();
    const name = toSafeString(raw.name).trim();
    if (!id || !name) return null;

    const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
    const codingAgents = Array.isArray(raw.codingAgents)
        ? raw.codingAgents.filter(
            (agent): agent is "coder" | "reviewer" | "improver" =>
                agent === "coder" || agent === "reviewer" || agent === "improver"
        )
        : [];

    return {
        id,
        name,
        color: toSafeString(raw.color, "#3b82f6"),
        backgroundImage: typeof raw.backgroundImage === "string" ? raw.backgroundImage : null,
        systemPrompt: toSafeString(raw.systemPrompt),
        repositoryPath: typeof raw.repositoryPath === "string" && raw.repositoryPath.trim().length > 0 ? raw.repositoryPath : null,
        defaultCodeFolder: typeof raw.defaultCodeFolder === "string" && raw.defaultCodeFolder.trim().length > 0 ? raw.defaultCodeFolder : null,
        codingAgents: codingAgents.length > 0 ? codingAgents : ["coder"],
        files: Array.isArray(raw.files) ? raw.files.map(normalizeProjectFile).filter((file): file is ProjectFile => file !== null) : [],
        chatIds: toSafeStringArray(raw.chatIds),
        createdAt,
        updatedAt,
    };
}

export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Load projects from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                const normalizedProjects = Array.isArray(parsed)
                    ? parsed.map(normalizeProject).filter((project): project is Project => project !== null)
                    : [];
                setProjects(normalizedProjects);

                const shouldRewriteStorage =
                    !Array.isArray(parsed) || normalizedProjects.length !== parsed.length;
                if (shouldRewriteStorage) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedProjects));
                }
            }
        } catch (error) {
            console.error("[useProjects] Failed to load projects:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Persist to localStorage on change
    useEffect(() => {
        if (!isLoading) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        }
    }, [projects, isLoading]);

    /**
     * Create a new project
     */
    const createProject = useCallback(async (data: CreateProjectData): Promise<Project> => {
        const now = Date.now();
        const newProject: Project = {
            id: `project_${now}_${Math.random().toString(36).slice(2, 8)}`,
            name: data.name,
            color: data.color,
            backgroundImage: data.backgroundImage,
            systemPrompt: data.systemPrompt,
            repositoryPath: data.repositoryPath || null,
            defaultCodeFolder: data.defaultCodeFolder || null,
            codingAgents: Array.isArray(data.codingAgents) ? data.codingAgents : ["coder"],
            files: data.files,
            chatIds: [],
            createdAt: now,
            updatedAt: now
        };

        setProjects((prev) => [...prev, newProject]);
        console.log(`[useProjects] Created project: ${newProject.name}`);

        return newProject;
    }, []);

    /**
     * Update an existing project
     */
    const updateProject = useCallback((projectId: string, updates: Partial<Omit<Project, "id" | "createdAt">>) => {
        setProjects((prev) =>
            prev.map((p) =>
                p.id === projectId
                    ? { ...p, ...updates, updatedAt: Date.now() }
                    : p
            )
        );
    }, []);

    /**
     * Delete a project
     */
    const deleteProject = useCallback((projectId: string) => {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
    }, []);

    /**
     * Add a chat to a project
     */
    const addChatToProject = useCallback((chatId: string, projectId: string) => {
        setProjects((prev) =>
            prev.map((p) => {
                if (p.id === projectId) {
                    if (!p.chatIds.includes(chatId)) {
                        return { ...p, chatIds: [...p.chatIds, chatId], updatedAt: Date.now() };
                    }
                }
                // Remove from other projects
                if (p.chatIds.includes(chatId)) {
                    return { ...p, chatIds: p.chatIds.filter((id) => id !== chatId), updatedAt: Date.now() };
                }
                return p;
            })
        );
    }, []);

    /**
     * Remove a chat from its project
     */
    const removeChatFromProject = useCallback((chatId: string) => {
        setProjects((prev) =>
            prev.map((p) => ({
                ...p,
                chatIds: p.chatIds.filter((id) => id !== chatId),
                updatedAt: p.chatIds.includes(chatId) ? Date.now() : p.updatedAt
            }))
        );
    }, []);

    /**
     * Get the project containing a specific chat
     */
    const getProjectForChat = useCallback(
        (chatId: string): Project | null => {
            return projects.find((p) => p.chatIds.includes(chatId)) || null;
        },
        [projects]
    );

    /**
     * Get project by ID
     */
    const getProject = useCallback(
        (projectId: string): Project | null => {
            return projects.find((p) => p.id === projectId) || null;
        },
        [projects]
    );

    /**
     * Rename a project
     */
    const renameProject = useCallback((projectId: string, newName: string) => {
        updateProject(projectId, { name: newName });
    }, [updateProject]);

    /**
     * Add files to a project
     */
    const addFilesToProject = useCallback((projectId: string, files: ProjectFile[]) => {
        setProjects((prev) =>
            prev.map((p) =>
                p.id === projectId
                    ? {
                        ...p,
                        files: [...p.files, ...files.filter(f => !p.files.some(pf => pf.id === f.id))],
                        updatedAt: Date.now()
                    }
                    : p
            )
        );
    }, []);

    /**
     * Remove a file from a project
     */
    const removeFileFromProject = useCallback((projectId: string, fileId: string) => {
        setProjects((prev) =>
            prev.map((p) =>
                p.id === projectId
                    ? {
                        ...p,
                        files: p.files.filter((f) => f.id !== fileId),
                        updatedAt: Date.now()
                    }
                    : p
            )
        );
    }, []);

    return {
        projects,
        isLoading,
        createProject,
        updateProject,
        deleteProject,
        addChatToProject,
        removeChatFromProject,
        getProjectForChat,
        getProject,
        renameProject,
        addFilesToProject,
        removeFileFromProject
    };
}

export default useProjects;
