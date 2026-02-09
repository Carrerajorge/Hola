/**
 * React hooks for Computer Use API
 *
 * Provides typed hooks for all computer control capabilities:
 * - useBrowserControl: Browser automation
 * - useTerminal: Terminal command execution
 * - useDocumentGenerator: PPT/DOC/Excel generation
 * - useVision: Computer vision analysis
 * - useAgentBrain: Autonomous agent control
 */

import { useState, useCallback, useRef } from "react";

const API_BASE = "/api/computer-use";

async function apiCall<T = any>(endpoint: string, method: string = "POST", body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ============================================
// Browser Control Hook
// ============================================

export function useBrowserControl() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSession = useCallback(async (profileId: string = "chrome-desktop") => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiCall("/browser/create-session", "POST", { profileId });
      setSessionId(res.sessionId);
      return res.sessionId;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const navigate = useCallback(async (url: string) => {
    if (!sessionId) return null;
    setLoading(true);
    try {
      return await apiCall("/browser/navigate", "POST", { sessionId, url });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const click = useCallback(async (selector: string) => {
    if (!sessionId) return null;
    return apiCall("/browser/click", "POST", { sessionId, selector });
  }, [sessionId]);

  const type = useCallback(async (selector: string, text: string) => {
    if (!sessionId) return null;
    return apiCall("/browser/type", "POST", { sessionId, selector, text, clear: true });
  }, [sessionId]);

  const screenshot = useCallback(async () => {
    if (!sessionId) return null;
    const res = await apiCall("/browser/screenshot", "POST", { sessionId });
    return res.screenshot;
  }, [sessionId]);

  const agenticNavigate = useCallback(async (goal: string, maxSteps: number = 15) => {
    if (!sessionId) return null;
    setLoading(true);
    try {
      return await apiCall("/browser/agentic-navigate", "POST", { sessionId, goal, maxSteps });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const extract = useCallback(async (rules: any[]) => {
    if (!sessionId) return null;
    return apiCall("/browser/extract", "POST", { sessionId, rules });
  }, [sessionId]);

  const extractStructured = useCallback(async (description: string) => {
    if (!sessionId) return null;
    return apiCall("/browser/extract-structured", "POST", { sessionId, description });
  }, [sessionId]);

  const closeSession = useCallback(async () => {
    if (!sessionId) return;
    await apiCall("/browser/close-session", "POST", { sessionId });
    setSessionId(null);
  }, [sessionId]);

  return {
    sessionId, loading, error,
    createSession, navigate, click, type, screenshot,
    agenticNavigate, extract, extractStructured, closeSession,
  };
}

// ============================================
// Terminal Hook
// ============================================

export function useTerminal() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const createSession = useCallback(async (cwd?: string) => {
    const res = await apiCall("/terminal/create-session", "POST", { cwd });
    setSessionId(res.sessionId);
    return res.sessionId;
  }, []);

  const execute = useCallback(async (command: string, options?: {
    timeout?: number;
    shell?: string;
  }) => {
    if (!sessionId) return null;
    setLoading(true);
    try {
      const result = await apiCall("/terminal/execute", "POST", {
        sessionId, command, ...options,
      });
      setHistory((prev) => [...prev, result]);
      return result;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const executeScript = useCallback(async (language: string, code: string) => {
    if (!sessionId) return null;
    setLoading(true);
    try {
      return await apiCall("/terminal/execute-script", "POST", { sessionId, language, code });
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const getSystemInfo = useCallback(async () => {
    return apiCall("/terminal/system-info", "GET");
  }, []);

  const listProcesses = useCallback(async (filter?: string) => {
    return apiCall(`/terminal/processes${filter ? `?filter=${filter}` : ""}`, "GET");
  }, []);

  const listPorts = useCallback(async () => {
    return apiCall("/terminal/ports", "GET");
  }, []);

  const closeSession = useCallback(async () => {
    if (!sessionId) return;
    await apiCall("/terminal/close-session", "POST", { sessionId });
    setSessionId(null);
    setHistory([]);
  }, [sessionId]);

  return {
    sessionId, history, loading,
    createSession, execute, executeScript,
    getSystemInfo, listProcesses, listPorts, closeSession,
  };
}

// ============================================
// Document Generator Hook
// ============================================

export function useDocumentGenerator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePpt = useCallback(async (request: {
    topic: string;
    slideCount?: number;
    template?: string;
    style?: string;
    language?: string;
    audience?: string;
    includeCharts?: boolean;
    includeSpeakerNotes?: boolean;
    customInstructions?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      return await apiCall("/generate/ppt", "POST", request);
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateDoc = useCallback(async (request: {
    topic: string;
    type?: string;
    language?: string;
    wordCount?: number;
    sections?: string[];
    includeTableOfContents?: boolean;
    includeCoverPage?: boolean;
    includeReferences?: boolean;
    author?: string;
    customInstructions?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      return await apiCall("/generate/doc", "POST", request);
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateExcel = useCallback(async (request: {
    topic: string;
    type?: string;
    description?: string;
    language?: string;
    columns?: string[];
    rowCount?: number;
    includeFormulas?: boolean;
    includeCharts?: boolean;
    includeConditionalFormatting?: boolean;
    includePivotSummary?: boolean;
    customInstructions?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      return await apiCall("/generate/excel", "POST", request);
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadBuffer = useCallback((buffer: string, fileName: string, mimeType: string) => {
    const bytes = atob(buffer);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const getTemplates = useCallback(async (type: "ppt" | "doc" | "excel") => {
    return apiCall(`/generate/${type}/templates`, "GET");
  }, []);

  return {
    loading, error,
    generatePpt, generateDoc, generateExcel,
    downloadBuffer, getTemplates,
  };
}

// ============================================
// Vision Hook
// ============================================

export function useVision() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const analyze = useCallback(async (image: string, query: string, mode: string = "analyze") => {
    setLoading(true);
    try {
      const res = await apiCall("/vision/analyze", "POST", { image, query, mode });
      setResult(res);
      return res;
    } finally {
      setLoading(false);
    }
  }, []);

  const ocr = useCallback(async (image: string) => {
    return analyze(image, "Extract all text", "ocr");
  }, [analyze]);

  const detectElements = useCallback(async (image: string) => {
    return analyze(image, "Detect all elements", "detect_elements");
  }, [analyze]);

  const findElement = useCallback(async (image: string, description: string) => {
    setLoading(true);
    try {
      const res = await apiCall("/vision/find-element", "POST", { image, description });
      setResult(res);
      return res;
    } finally {
      setLoading(false);
    }
  }, []);

  const analyzeAccessibility = useCallback(async (image: string) => {
    return analyze(image, "Analyze accessibility", "accessibility");
  }, [analyze]);

  return {
    loading, result,
    analyze, ocr, detectElements, findElement, analyzeAccessibility,
  };
}

// ============================================
// Autonomous Agent Hook
// ============================================

export function useAgentBrain() {
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<string>("idle");
  const [result, setResult] = useState<any>(null);

  const executeGoal = useCallback(async (goal: {
    description: string;
    category?: string;
    priority?: string;
    constraints?: any;
    successCriteria?: string[];
  }, context?: any) => {
    setLoading(true);
    setState("thinking");
    try {
      const res = await apiCall("/agent/execute-goal", "POST", { goal, context });
      setResult(res);
      setState(res.success ? "completed" : "error");
      return res;
    } catch (err: any) {
      setState("error");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const decomposeGoal = useCallback(async (goal: any, context?: any) => {
    return apiCall("/agent/decompose-goal", "POST", { goal, context });
  }, []);

  const suggestTasks = useCallback(async (context: any) => {
    return apiCall("/agent/suggest-tasks", "POST", { context });
  }, []);

  const getState = useCallback(async () => {
    return apiCall("/agent/state", "GET");
  }, []);

  return {
    loading, state, result,
    executeGoal, decomposeGoal, suggestTasks, getState,
  };
}

// ============================================
// Capabilities Hook
// ============================================

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<any>(null);

  const fetch = useCallback(async () => {
    const res = await apiCall("/capabilities", "GET");
    setCapabilities(res.capabilities);
    return res.capabilities;
  }, []);

  return { capabilities, fetchCapabilities: fetch };
}
