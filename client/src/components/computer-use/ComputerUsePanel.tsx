/**
 * Computer Use Panel - Main UI for agentic computer control
 *
 * Provides a visual interface for:
 * - Browser control with live preview
 * - Terminal/shell execution
 * - Document generation (PPT, DOC, Excel)
 * - Screen analysis with vision
 * - Autonomous task execution
 */

import React, { useState, useCallback, useRef, useEffect } from "react";

// ============================================
// Types
// ============================================

interface Tab {
  id: string;
  label: string;
  icon: string;
}

interface BrowserSession {
  id: string;
  url: string;
  title: string;
  screenshot?: string;
}

interface TerminalLine {
  id: string;
  type: "command" | "stdout" | "stderr" | "info";
  content: string;
  timestamp: number;
}

interface GenerationResult {
  id: string;
  type: "ppt" | "doc" | "excel";
  fileName: string;
  buffer?: string;
  metadata: Record<string, any>;
}

// ============================================
// API Client
// ============================================

const API_BASE = "/api/computer-use";

async function apiCall(endpoint: string, method: string = "POST", body?: any): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errorText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errorText}` };
    }
    return res.json();
  } catch (error: any) {
    return { success: false, error: error.message || "Network error" };
  }
}

// ============================================
// Sub-Components
// ============================================

function BrowserControlView() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [url, setUrl] = useState("https://www.google.com");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agenticGoal, setAgenticGoal] = useState("");
  const [result, setResult] = useState<any>(null);

  const createSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall("/browser/create-session", "POST", { profileId: "chrome-desktop" });
      if (res.success) setSessionId(res.sessionId);
    } finally {
      setLoading(false);
    }
  }, []);

  const navigate = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await apiCall("/browser/navigate", "POST", { sessionId, url });
      const screenshotRes = await apiCall("/browser/screenshot", "POST", { sessionId });
      if (screenshotRes.success) setScreenshot(screenshotRes.screenshot);
    } finally {
      setLoading(false);
    }
  }, [sessionId, url]);

  const agenticNav = useCallback(async () => {
    if (!sessionId || !agenticGoal) return;
    setLoading(true);
    try {
      const res = await apiCall("/browser/agentic-navigate", "POST", {
        sessionId,
        goal: agenticGoal,
        maxSteps: 15,
      });
      setResult(res);
      if (res.screenshots?.length) {
        setScreenshot(res.screenshots[res.screenshots.length - 1]);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, agenticGoal]);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2">
        <button
          onClick={createSession}
          disabled={loading || !!sessionId}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {sessionId ? "Session Active" : "Start Browser"}
        </button>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate()}
          placeholder="https://..."
          className="flex-1 px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={navigate}
          disabled={loading || !sessionId}
          className="px-3 py-1.5 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-600 disabled:opacity-50"
        >
          Go
        </button>
      </div>

      {/* Agentic Navigation */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={agenticGoal}
          onChange={(e) => setAgenticGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agenticNav()}
          placeholder="Describe what you want the browser to do..."
          className="flex-1 px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700 focus:border-purple-500 focus:outline-none"
        />
        <button
          onClick={agenticNav}
          disabled={loading || !sessionId}
          className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? "Working..." : "🤖 Auto-Navigate"}
        </button>
      </div>

      {/* Screenshot Preview */}
      <div className="flex-1 bg-gray-900 rounded-lg overflow-hidden border border-gray-700 min-h-[400px]">
        {screenshot ? (
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="Browser screenshot"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            {sessionId ? "Navigate to a URL to see the page" : "Start a browser session to begin"}
          </div>
        )}
      </div>

      {/* Agent Result */}
      {result && (
        <div className="bg-gray-800 rounded-lg p-3 text-sm">
          <div className="text-gray-400 mb-1">
            {result.success ? "✅ Task completed" : "⚠️ Task incomplete"}
            {" • "}{result.steps?.length || 0} steps taken
          </div>
          {result.steps?.map((step: string, i: number) => (
            <div key={i} className="text-gray-300 text-xs ml-4">
              {i + 1}. {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TerminalView() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [loading, setLoading] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const createSession = useCallback(async () => {
    const res = await apiCall("/terminal/create-session", "POST", {});
    if (res.success) {
      setSessionId(res.sessionId);
      setLines([{ id: "init", type: "info", content: `Terminal session started. CWD: ${res.cwd || "/"}`, timestamp: Date.now() }]);
    }
  }, []);

  useEffect(() => {
    createSession();
  }, [createSession]);

  const executeCommand = useCallback(async () => {
    if (!sessionId || !command.trim()) return;

    const cmdLine: TerminalLine = {
      id: `cmd-${Date.now()}`,
      type: "command",
      content: `$ ${command}`,
      timestamp: Date.now(),
    };
    setLines((prev) => [...prev, cmdLine]);
    setCommand("");
    setLoading(true);

    try {
      const res = await apiCall("/terminal/execute", "POST", { sessionId, command });

      if (res.stdout) {
        setLines((prev) => [...prev, {
          id: `out-${Date.now()}`,
          type: "stdout",
          content: res.stdout,
          timestamp: Date.now(),
        }]);
      }
      if (res.stderr) {
        setLines((prev) => [...prev, {
          id: `err-${Date.now()}`,
          type: "stderr",
          content: res.stderr,
          timestamp: Date.now(),
        }]);
      }
    } finally {
      setLoading(false);
    }

    // Auto-scroll
    setTimeout(() => {
      terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }, [sessionId, command]);

  return (
    <div className="flex flex-col h-full">
      {/* Terminal output */}
      <div
        ref={terminalRef}
        className="flex-1 bg-black rounded-lg p-3 font-mono text-sm overflow-auto min-h-[400px]"
      >
        {lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap ${
              line.type === "command" ? "text-green-400" :
              line.type === "stderr" ? "text-red-400" :
              line.type === "info" ? "text-blue-400" :
              "text-gray-300"
            }`}
          >
            {line.content}
          </div>
        ))}
        {loading && <div className="text-yellow-400 animate-pulse">Executing...</div>}
      </div>

      {/* Command input */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-green-400 font-mono text-sm">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && executeCommand()}
          placeholder="Enter command..."
          className="flex-1 px-3 py-1.5 bg-black text-green-400 font-mono text-sm rounded-md border border-gray-700 focus:border-green-500 focus:outline-none"
          autoFocus
        />
        <button
          onClick={executeCommand}
          disabled={loading}
          className="px-3 py-1.5 bg-green-700 text-white text-sm rounded-md hover:bg-green-600 disabled:opacity-50"
        >
          Run
        </button>
      </div>
    </div>
  );
}

function DocumentGeneratorView() {
  const [docType, setDocType] = useState<"ppt" | "doc" | "excel">("ppt");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [options, setOptions] = useState({
    slideCount: 10,
    template: "corporate",
    style: "professional",
    type: "report",
    language: "en",
    includeCharts: true,
    includeSpeakerNotes: true,
  });

  const generate = useCallback(async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const endpoint = `/generate/${docType}`;
      const body = docType === "ppt"
        ? { topic, slideCount: options.slideCount, template: options.template, style: options.style, language: options.language, includeCharts: options.includeCharts, includeSpeakerNotes: options.includeSpeakerNotes }
        : docType === "doc"
        ? { topic, type: options.type, language: options.language }
        : { topic, type: "spreadsheet", language: options.language };

      const res = await apiCall(endpoint, "POST", body);

      if (res.success) {
        setResult({
          id: res.id,
          type: docType,
          fileName: res.fileName,
          buffer: res.buffer,
          metadata: res.metadata || {},
        });
      }
    } finally {
      setLoading(false);
    }
  }, [topic, docType, options]);

  const download = useCallback(() => {
    if (!result?.buffer) return;

    const mimeTypes = {
      ppt: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      doc: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    const bytes = atob(result.buffer);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);

    const blob = new Blob([arr], { type: mimeTypes[result.type] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="flex flex-col gap-4">
      {/* Document type selector */}
      <div className="flex gap-2">
        {(["ppt", "doc", "excel"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setDocType(type)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              docType === type
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {type === "ppt" ? "📊 Presentation" : type === "doc" ? "📄 Document" : "📈 Spreadsheet"}
          </button>
        ))}
      </div>

      {/* Topic input */}
      <input
        type="text"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && generate()}
        placeholder={
          docType === "ppt" ? "Describe your presentation topic..."
          : docType === "doc" ? "Describe your document topic..."
          : "Describe your spreadsheet data..."
        }
        className="px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
      />

      {/* Options */}
      <div className="grid grid-cols-3 gap-3">
        {docType === "ppt" && (
          <>
            <select
              value={options.template}
              onChange={(e) => setOptions({ ...options, template: e.target.value })}
              className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700"
            >
              <option value="corporate">Corporate</option>
              <option value="modern_minimal">Modern Minimal</option>
              <option value="gradient_flow">Gradient Flow</option>
              <option value="tech_startup">Tech Startup</option>
              <option value="elegant_dark">Elegant Dark</option>
              <option value="academic">Academic</option>
              <option value="pitch_deck">Pitch Deck</option>
              <option value="creative">Creative Bold</option>
            </select>
            <select
              value={options.slideCount}
              onChange={(e) => setOptions({ ...options, slideCount: parseInt(e.target.value) })}
              className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700"
            >
              {[5, 8, 10, 12, 15, 20].map((n) => (
                <option key={n} value={n}>{n} slides</option>
              ))}
            </select>
          </>
        )}
        {docType === "doc" && (
          <select
            value={options.type}
            onChange={(e) => setOptions({ ...options, type: e.target.value })}
            className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700"
          >
            <option value="report">Report</option>
            <option value="essay">Essay</option>
            <option value="proposal">Proposal</option>
            <option value="letter">Letter</option>
            <option value="thesis">Thesis</option>
            <option value="whitepaper">Whitepaper</option>
            <option value="memo">Memo</option>
          </select>
        )}
        <select
          value={options.language}
          onChange={(e) => setOptions({ ...options, language: e.target.value })}
          className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700"
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="pt">Português</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
      </div>

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={loading || !topic.trim()}
        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all"
      >
        {loading ? "Generating..." : `Generate ${docType === "ppt" ? "Presentation" : docType === "doc" ? "Document" : "Spreadsheet"}`}
      </button>

      {/* Result */}
      {result && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-medium">{result.fileName}</h3>
            <button
              onClick={download}
              className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
            >
              Download
            </button>
          </div>
          <div className="text-gray-400 text-sm space-y-1">
            {Object.entries(result.metadata).map(([key, value]) => (
              <div key={key}>
                <span className="text-gray-500">{key}:</span> {String(value)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VisionAnalysisView() {
  const [image, setImage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"analyze" | "ocr" | "detect_elements" | "accessibility">("analyze");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setImage(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  const analyze = useCallback(async () => {
    if (!image) return;
    setLoading(true);

    try {
      const res = await apiCall("/vision/analyze", "POST", { image, query, mode });
      if (res.success) setResult(res);
    } finally {
      setLoading(false);
    }
  }, [image, query, mode]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["analyze", "ocr", "detect_elements", "accessibility"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-md text-sm ${mode === m ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
          >
            {m === "analyze" ? "🔍 Analyze" : m === "ocr" ? "📝 OCR" : m === "detect_elements" ? "🎯 Detect" : "♿ Accessibility"}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="text-sm text-gray-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What to analyze..."
          className="flex-1 px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md border border-gray-700"
        />
        <button
          onClick={analyze}
          disabled={loading || !image}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md disabled:opacity-50"
        >
          {loading ? "..." : "Analyze"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {image && (
          <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
            <img src={`data:image/png;base64,${image}`} alt="Upload" className="w-full" />
          </div>
        )}
        {result && (
          <div className="bg-gray-800 rounded-lg p-3 overflow-auto max-h-[500px]">
            <pre className="text-xs text-gray-300 whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Main Panel
// ============================================

const TABS: Tab[] = [
  { id: "browser", label: "Browser Control", icon: "🌐" },
  { id: "terminal", label: "Terminal", icon: "💻" },
  { id: "documents", label: "Generate Docs", icon: "📄" },
  { id: "vision", label: "Vision", icon: "👁️" },
];

export default function ComputerUsePanel() {
  const [activeTab, setActiveTab] = useState("browser");

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-700 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-gray-300"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 p-4 overflow-auto">
        {activeTab === "browser" && <BrowserControlView />}
        {activeTab === "terminal" && <TerminalView />}
        {activeTab === "documents" && <DocumentGeneratorView />}
        {activeTab === "vision" && <VisionAnalysisView />}
      </div>
    </div>
  );
}
