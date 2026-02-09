import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { useTerminalSession, TerminalLine } from "@/hooks/use-terminal-session";

export function TerminalPanel() {
  const {
    state,
    createSession,
    executeCommand,
    executeScript,
    closeSession,
    clearOutput,
    getSystemInfo,
    listProcesses,
    killProcess,
  } = useTerminalSession();

  const [inputValue, setInputValue] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [showProcesses, setShowProcesses] = useState(false);
  const [processes, setProcesses] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"terminal" | "scripts" | "files">("terminal");
  const [scriptLanguage, setScriptLanguage] = useState("python");
  const [scriptCode, setScriptCode] = useState("");

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [state.lines]);

  // Auto-focus input
  useEffect(() => {
    if (state.status === "active" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [state.status]);

  const handleCreateSession = useCallback(async () => {
    await createSession();
  }, [createSession]);

  const handleExecuteCommand = useCallback(async () => {
    const cmd = inputValue.trim();
    if (!cmd) return;

    setCommandHistory((prev) => [...prev, cmd]);
    setHistoryIndex(-1);
    setInputValue("");

    // Handle built-in commands
    if (cmd === "clear" || cmd === "cls") {
      clearOutput();
      return;
    }

    if (cmd === "exit") {
      await closeSession();
      return;
    }

    if (cmd === "sysinfo") {
      const info = await getSystemInfo();
      if (info) {
        setSystemInfo(info);
        setShowSystemInfo(true);
      }
      return;
    }

    if (cmd === "ps" || cmd === "processes") {
      const data = await listProcesses();
      if (data?.processes) {
        setProcesses(data.processes);
        setShowProcesses(true);
      }
      return;
    }

    await executeCommand(cmd);
  }, [inputValue, executeCommand, clearOutput, closeSession, getSystemInfo, listProcesses]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleExecuteCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || "");
      } else {
        setHistoryIndex(-1);
        setInputValue("");
      }
    } else if (e.key === "c" && e.ctrlKey) {
      setInputValue("");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clearOutput();
    }
  }, [handleExecuteCommand, commandHistory, historyIndex, clearOutput]);

  const handleRunScript = useCallback(async () => {
    if (!scriptCode.trim()) return;
    await executeScript(scriptLanguage, scriptCode);
  }, [executeScript, scriptLanguage, scriptCode]);

  const handleKillProcess = useCallback(async (pid: number) => {
    await killProcess(pid);
    const data = await listProcesses();
    if (data?.processes) {
      setProcesses(data.processes);
    }
  }, [killProcess, listProcesses]);

  const getLineColor = (type: TerminalLine["type"]): string => {
    switch (type) {
      case "input": return "text-cyan-400";
      case "stdout": return "text-gray-200";
      case "stderr": return "text-red-400";
      case "system": return "text-yellow-400";
      case "error": return "text-red-500 font-bold";
      default: return "text-gray-300";
    }
  };

  if (state.status === "idle" || state.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-950 p-8 rounded-lg">
        <div className="text-center space-y-4">
          <div className="text-4xl mb-2">{">"}_</div>
          <h2 className="text-xl font-bold text-white">Terminal Control</h2>
          <p className="text-gray-400 max-w-md">
            Full system terminal access with command execution, file operations,
            process management, and script execution.
          </p>
          {state.error && (
            <p className="text-red-400 text-sm">{state.error}</p>
          )}
          <button
            onClick={handleCreateSession}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            Start Terminal Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500 cursor-pointer" onClick={closeSession} title="Close" />
            <div className="w-3 h-3 rounded-full bg-yellow-500 cursor-pointer" onClick={clearOutput} title="Clear" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-gray-400 text-sm font-mono">
            {state.cwd || "~"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
          {(["terminal", "scripts", "files"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                activeTab === tab
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Tab */}
      {activeTab === "terminal" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Output */}
          <div
            ref={terminalRef}
            className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
            onClick={() => inputRef.current?.focus()}
          >
            {state.lines.map((line) => (
              <div key={line.id} className={`${getLineColor(line.type)} whitespace-pre-wrap break-all`}>
                {line.content}
              </div>
            ))}
            {state.isExecuting && (
              <div className="text-yellow-400 animate-pulse">Running...</div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center px-4 py-3 bg-gray-900 border-t border-gray-800">
            <span className="text-green-400 font-mono text-sm mr-2">$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={state.isExecuting ? "Waiting for command to finish..." : "Type a command..."}
              disabled={state.isExecuting}
              className="flex-1 bg-transparent text-gray-200 font-mono text-sm outline-none placeholder-gray-600 disabled:opacity-50"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* Scripts Tab */}
      {activeTab === "scripts" && (
        <div className="flex flex-col flex-1 p-4 overflow-hidden">
          <div className="flex items-center gap-3 mb-3">
            <select
              value={scriptLanguage}
              onChange={(e) => setScriptLanguage(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 text-gray-200 rounded border border-gray-700 text-sm"
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="bash">Bash</option>
              <option value="ruby">Ruby</option>
              <option value="go">Go</option>
              <option value="php">PHP</option>
            </select>
            <button
              onClick={handleRunScript}
              disabled={state.isExecuting || !scriptCode.trim()}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white rounded text-sm font-medium transition-colors"
            >
              Run Script
            </button>
          </div>
          <textarea
            value={scriptCode}
            onChange={(e) => setScriptCode(e.target.value)}
            placeholder={`Enter your ${scriptLanguage} code here...`}
            className="flex-1 p-3 bg-gray-900 text-gray-200 font-mono text-sm rounded border border-gray-700 resize-none outline-none focus:border-blue-500"
            spellCheck={false}
          />
        </div>
      )}

      {/* Files Tab */}
      {activeTab === "files" && (
        <div className="flex-1 p-4 overflow-y-auto">
          <p className="text-gray-400 text-sm mb-3">
            Use the terminal to navigate and manage files. Quick commands:
          </p>
          <div className="space-y-2">
            {[
              { cmd: "ls -la", desc: "List files with details" },
              { cmd: "pwd", desc: "Print working directory" },
              { cmd: "find . -name '*.ts' | head -20", desc: "Find TypeScript files" },
              { cmd: "du -sh *", desc: "Directory sizes" },
              { cmd: "tree -L 2", desc: "Directory tree" },
              { cmd: "df -h", desc: "Disk usage" },
              { cmd: "free -h", desc: "Memory usage" },
            ].map(({ cmd, desc }) => (
              <button
                key={cmd}
                onClick={() => {
                  setActiveTab("terminal");
                  setInputValue(cmd);
                  setTimeout(() => inputRef.current?.focus(), 100);
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-900 hover:bg-gray-800 rounded text-sm transition-colors"
              >
                <code className="text-cyan-400 font-mono">{cmd}</code>
                <span className="text-gray-500">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* System Info Modal */}
      {showSystemInfo && systemInfo && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">System Information</h3>
              <button onClick={() => setShowSystemInfo(false)} className="text-gray-400 hover:text-white">
                Close
              </button>
            </div>
            <div className="space-y-4 text-sm font-mono">
              <div>
                <h4 className="text-yellow-400 font-bold mb-1">OS</h4>
                <p className="text-gray-300">
                  {systemInfo.os?.platform} {systemInfo.os?.release} ({systemInfo.os?.arch})
                </p>
                <p className="text-gray-400">Hostname: {systemInfo.os?.hostname}</p>
              </div>
              <div>
                <h4 className="text-yellow-400 font-bold mb-1">CPU</h4>
                <p className="text-gray-300">{systemInfo.cpu?.model}</p>
                <p className="text-gray-400">{systemInfo.cpu?.cores} cores @ {systemInfo.cpu?.speed} MHz</p>
              </div>
              <div>
                <h4 className="text-yellow-400 font-bold mb-1">Memory</h4>
                <p className="text-gray-300">
                  {Math.round(systemInfo.memory?.used / 1024 / 1024 / 1024 * 100) / 100} GB /
                  {" "}{Math.round(systemInfo.memory?.total / 1024 / 1024 / 1024 * 100) / 100} GB
                  ({systemInfo.memory?.usagePercent}%)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Process Manager Modal */}
      {showProcesses && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Running Processes</h3>
              <button onClick={() => setShowProcesses(false)} className="text-gray-400 hover:text-white">
                Close
              </button>
            </div>
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-1 pr-4">PID</th>
                  <th className="text-left py-1 pr-4">Name</th>
                  <th className="text-right py-1 pr-4">CPU%</th>
                  <th className="text-right py-1 pr-4">MEM%</th>
                  <th className="text-center py-1">Action</th>
                </tr>
              </thead>
              <tbody>
                {processes.slice(0, 30).map((proc) => (
                  <tr key={proc.pid} className="text-gray-300 border-b border-gray-800 hover:bg-gray-800">
                    <td className="py-1 pr-4">{proc.pid}</td>
                    <td className="py-1 pr-4 truncate max-w-[200px]">{proc.name}</td>
                    <td className="py-1 pr-4 text-right">{proc.cpu}</td>
                    <td className="py-1 pr-4 text-right">{proc.memory}</td>
                    <td className="py-1 text-center">
                      <button
                        onClick={() => handleKillProcess(proc.pid)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Kill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
