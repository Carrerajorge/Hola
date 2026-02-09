/**
 * Computer Use Dashboard - Unified Browser + Terminal Control Interface
 *
 * Split-view dashboard combining:
 * - Browser automation with visual viewport and element picker
 * - Terminal with command execution and script runner
 * - Workflow automation builder
 * - Session management and recording
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { TerminalPanel } from "../terminal-panel";
import { BrowserControlPanel } from "../browser-control-panel";

type ActiveView = "split" | "browser" | "terminal" | "workflows";
type SplitOrientation = "horizontal" | "vertical";

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: any[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "web-scrape",
    name: "Web Scraper",
    description: "Navigate to a URL, extract data, and save results",
    icon: "D",
    steps: [
      { type: "action", name: "Open Browser", tool: "browser", action: "createSession", params: { profileId: "chrome-desktop" } },
      { type: "action", name: "Navigate", tool: "browser", action: "navigate", params: { url: "{{targetUrl}}" } },
      { type: "action", name: "Extract Data", tool: "browser", action: "extractStructured", params: { description: "{{extractionGoal}}" }, saveResultAs: "extractedData" },
      { type: "action", name: "Save Results", tool: "terminal", action: "execute", params: { command: "echo '{{extractedData}}' > /tmp/scraped-data.json" } },
    ],
  },
  {
    id: "deploy-check",
    name: "Deploy & Verify",
    description: "Run deploy script, then verify the site loads correctly",
    icon: "R",
    steps: [
      { type: "action", name: "Run Deploy", tool: "terminal", action: "execute", params: { command: "{{deployCommand}}" }, saveResultAs: "deployResult" },
      { type: "action", name: "Wait for Deploy", tool: "wait", duration: 5000 },
      { type: "action", name: "Open Browser", tool: "browser", action: "createSession", params: { profileId: "chrome-desktop" } },
      { type: "action", name: "Check Site", tool: "browser", action: "navigate", params: { url: "{{siteUrl}}" } },
      { type: "action", name: "Take Screenshot", tool: "browser", action: "screenshot", params: {}, saveResultAs: "verificationScreenshot" },
    ],
  },
  {
    id: "test-suite",
    name: "Test Runner",
    description: "Run tests, capture output, and generate report",
    icon: "T",
    steps: [
      { type: "action", name: "Run Tests", tool: "terminal", action: "execute", params: { command: "{{testCommand}}", timeout: 120000 }, saveResultAs: "testOutput" },
      { type: "condition", name: "Check Results", condition: { variable: "testOutput.success", operator: "equals", value: true },
        then: [
          { type: "action", name: "Success Log", tool: "notify", action: "send", params: { message: "All tests passed!", level: "success" } },
        ],
        else: [
          { type: "action", name: "Failure Log", tool: "notify", action: "send", params: { message: "Tests failed: {{testOutput.stderr}}", level: "error" } },
        ],
      },
    ],
  },
  {
    id: "monitor-site",
    name: "Site Monitor",
    description: "Check multiple URLs and report status",
    icon: "M",
    steps: [
      { type: "action", name: "Open Browser", tool: "browser", action: "createSession", params: { profileId: "chrome-desktop" } },
      { type: "loop", name: "Check Each URL", mode: "forEach", collection: "urls", iteratorVariable: "currentUrl", steps: [
        { type: "action", name: "Navigate", tool: "browser", action: "navigate", params: { url: "{{currentUrl}}" }, saveResultAs: "navResult" },
        { type: "action", name: "Record Status", tool: "transform", action: "append", params: { variable: "results", value: { url: "{{currentUrl}}", status: "{{navResult.status}}" } } },
      ]},
    ],
  },
];

export function ComputerUseDashboard() {
  const [activeView, setActiveView] = useState<ActiveView>("split");
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>("horizontal");
  const [splitRatio, setSplitRatio] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [showWorkflowBuilder, setShowWorkflowBuilder] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [workflowVars, setWorkflowVars] = useState<Record<string, string>>({});
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowLog, setWorkflowLog] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch system info on mount
  useEffect(() => {
    fetch("/api/terminal/system-info")
      .then((r) => r.json())
      .then(setSystemInfo)
      .catch(() => {});
  }, []);

  // Handle split resizing
  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (splitOrientation === "horizontal") {
        const newRatio = ((e.clientX - rect.left) / rect.width) * 100;
        setSplitRatio(Math.max(20, Math.min(80, newRatio)));
      } else {
        const newRatio = ((e.clientY - rect.top) / rect.height) * 100;
        setSplitRatio(Math.max(20, Math.min(80, newRatio)));
      }
    },
    [isDragging, splitOrientation]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Extract template variables
  const getTemplateVariables = useCallback((template: WorkflowTemplate): string[] => {
    const vars = new Set<string>();
    const json = JSON.stringify(template.steps);
    const matches = json.match(/\{\{(\w+)\}\}/g);
    if (matches) {
      for (const m of matches) {
        const varName = m.replace(/\{\{|\}\}/g, "");
        if (!varName.includes(".")) vars.add(varName);
      }
    }
    return Array.from(vars);
  }, []);

  // Run workflow
  const runWorkflow = useCallback(async () => {
    if (!selectedTemplate) return;
    setWorkflowRunning(true);
    setWorkflowLog(["Starting workflow: " + selectedTemplate.name]);

    try {
      const res = await fetch("/api/computer-use/task/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: {
            name: selectedTemplate.name,
            steps: selectedTemplate.steps,
            variables: workflowVars,
          },
          variables: workflowVars,
        }),
      });

      const result = await res.json();
      setWorkflowLog((prev) => [
        ...prev,
        `Status: ${result.status || "completed"}`,
        `Steps: ${result.stepsCompleted || 0}/${result.totalSteps || 0}`,
        result.error ? `Error: ${result.error}` : "Workflow completed successfully",
      ]);
    } catch (error: any) {
      setWorkflowLog((prev) => [...prev, `Error: ${error.message}`]);
    } finally {
      setWorkflowRunning(false);
    }
  }, [selectedTemplate, workflowVars]);

  return (
    <div
      className="flex flex-col h-screen bg-gray-950 text-white"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold">Computer Use</h1>

          {/* View Switcher */}
          <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
            {(["split", "browser", "terminal", "workflows"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  activeView === view
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {view.charAt(0).toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Split orientation toggle */}
          {activeView === "split" && (
            <button
              onClick={() =>
                setSplitOrientation((o) =>
                  o === "horizontal" ? "vertical" : "horizontal"
                )
              }
              className="px-2 py-1 text-xs bg-gray-800 text-gray-400 hover:text-white rounded"
              title="Toggle split orientation"
            >
              {splitOrientation === "horizontal" ? "[ | ]" : "[-]"}
            </button>
          )}

          {/* System status */}
          {systemInfo && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>CPU: {systemInfo.cpu?.cores || "?"}c</span>
              <span>RAM: {systemInfo.memory?.usagePercent || "?"}%</span>
              <span>{systemInfo.os?.platform || ""}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative">
        {/* Split View */}
        {activeView === "split" && (
          <div
            className={`flex h-full ${
              splitOrientation === "vertical" ? "flex-col" : "flex-row"
            }`}
          >
            {/* Browser Panel */}
            <div
              style={{
                [splitOrientation === "horizontal" ? "width" : "height"]: `${splitRatio}%`,
              }}
              className="overflow-hidden"
            >
              <BrowserControlPanel />
            </div>

            {/* Resize Handle */}
            <div
              className={`flex items-center justify-center bg-gray-800 hover:bg-blue-600/30 transition-colors ${
                splitOrientation === "horizontal"
                  ? "w-1 cursor-col-resize"
                  : "h-1 cursor-row-resize"
              } ${isDragging ? "bg-blue-600/50" : ""}`}
              onMouseDown={handleMouseDown}
            />

            {/* Terminal Panel */}
            <div className="flex-1 overflow-hidden">
              <TerminalPanel />
            </div>
          </div>
        )}

        {/* Browser Only */}
        {activeView === "browser" && <BrowserControlPanel />}

        {/* Terminal Only */}
        {activeView === "terminal" && <TerminalPanel />}

        {/* Workflows */}
        {activeView === "workflows" && (
          <div className="flex h-full">
            {/* Template List */}
            <div className="w-80 bg-gray-900 border-r border-gray-800 overflow-y-auto p-4">
              <h2 className="text-sm font-bold mb-3">Workflow Templates</h2>
              <div className="space-y-2">
                {WORKFLOW_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplate(template);
                      setShowWorkflowBuilder(true);
                      setWorkflowVars({});
                      setWorkflowLog([]);
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedTemplate?.id === template.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-700 bg-gray-800 hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center text-sm font-bold">
                        {template.icon}
                      </div>
                      <span className="font-medium text-sm">{template.name}</span>
                    </div>
                    <p className="text-xs text-gray-400">{template.description}</p>
                    <p className="text-xs text-gray-500 mt-1">{template.steps.length} steps</p>
                  </button>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-800">
                <h3 className="text-xs text-gray-400 font-bold mb-2">Custom Workflow</h3>
                <p className="text-xs text-gray-500">
                  Use the API at{" "}
                  <code className="text-blue-400">/api/terminal/sessions/:id/exec</code> or{" "}
                  <code className="text-blue-400">/api/browser-control/sessions/:id/task</code>{" "}
                  to create custom automation workflows programmatically.
                </p>
              </div>
            </div>

            {/* Workflow Builder/Runner */}
            <div className="flex-1 overflow-y-auto p-6">
              {!showWorkflowBuilder || !selectedTemplate ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <div className="text-4xl mb-4">Workflows</div>
                  <p className="text-sm">Select a workflow template to get started</p>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-6">
                  <div>
                    <h2 className="text-xl font-bold">{selectedTemplate.name}</h2>
                    <p className="text-gray-400 text-sm mt-1">{selectedTemplate.description}</p>
                  </div>

                  {/* Steps visualization */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-gray-300">Steps</h3>
                    {selectedTemplate.steps.map((step: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-800"
                      >
                        <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{step.name || step.type}</p>
                          <p className="text-xs text-gray-500">
                            {step.tool ? `${step.tool}.${step.action}` : step.type}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Variables */}
                  {getTemplateVariables(selectedTemplate).length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-bold text-gray-300">Variables</h3>
                      {getTemplateVariables(selectedTemplate).map((varName) => (
                        <div key={varName}>
                          <label className="text-xs text-gray-400 block mb-1">{varName}</label>
                          <input
                            type="text"
                            value={workflowVars[varName] || ""}
                            onChange={(e) =>
                              setWorkflowVars((prev) => ({ ...prev, [varName]: e.target.value }))
                            }
                            placeholder={`Enter ${varName}...`}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 outline-none focus:border-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Run button */}
                  <button
                    onClick={runWorkflow}
                    disabled={workflowRunning}
                    className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                  >
                    {workflowRunning ? "Running..." : "Run Workflow"}
                  </button>

                  {/* Execution Log */}
                  {workflowLog.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-gray-300">Execution Log</h3>
                      <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                        {workflowLog.map((log, i) => (
                          <div key={i} className="text-xs font-mono text-gray-300 py-0.5">
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
