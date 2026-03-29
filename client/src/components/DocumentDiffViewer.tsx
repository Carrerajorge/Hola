/**
 * Document Diff Viewer
 * 
 * Comparación visual de documentos con colores para diferencias.
 */

import React, { useMemo, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Columns, FileText, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface DiffLine {
  type: "unchanged" | "added" | "removed" | "modified";
  lineNumber: { left?: number; right?: number };
  content: { left?: string; right?: string };
}

interface DocumentDiffViewerProps {
  leftContent: string;
  rightContent: string;
  leftTitle?: string;
  rightTitle?: string;
  leftType?: "text" | "html";
  rightType?: "text" | "html";
}

// Simple line-by-line diff algorithm
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diff: DiffLine[] = [];

  // Build LCS matrix for optimal diff
  const lcs = buildLCS(oldLines, newLines);

  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({
        type: "unchanged",
        lineNumber: { left: oldLineNum, right: newLineNum },
        content: { left: oldLines[i], right: newLines[j] },
      });
      i++;
      j++;
      oldLineNum++;
      newLineNum++;
    } else if (j < newLines.length && (i >= oldLines.length || !lcs[i]?.[j])) {
      diff.push({
        type: "added",
        lineNumber: { right: newLineNum },
        content: { right: newLines[j] },
      });
      j++;
      newLineNum++;
    } else if (i < oldLines.length) {
      diff.push({
        type: "removed",
        lineNumber: { left: oldLineNum },
        content: { left: oldLines[i] },
      });
      i++;
      oldLineNum++;
    } else {
      i++;
      j++;
    }
  }

  return diff;
}

function buildLCS(oldLines: string[], newLines: string[]): boolean[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: boolean[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(false));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = true;
      } else {
        dp[i][j] = dp[i + 1]?.[j] || dp[i]?.[j + 1] || false;
      }
    }
  }

  return dp;
}

export function DocumentDiffViewer({
  leftContent,
  rightContent,
  leftTitle = "Documento original",
  rightTitle = "Documento nuevo",
  leftType = "text",
  rightType = "text",
}: DocumentDiffViewerProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("split");
  const [currentDiff, setCurrentDiff] = useState(0);

  const diff = useMemo(() => {
    const left = leftType === "html" ? stripHtml(leftContent) : leftContent;
    const right = rightType === "html" ? stripHtml(rightContent) : rightContent;
    return computeDiff(left, right);
  }, [leftContent, rightContent, leftType, rightType]);

  const stats = useMemo(() => {
    const added = diff.filter((d) => d.type === "added").length;
    const removed = diff.filter((d) => d.type === "removed").length;
    const unchanged = diff.filter((d) => d.type === "unchanged").length;
    return { added, removed, unchanged, total: diff.length };
  }, [diff]);

  const diffOnly = useMemo(() => {
    return diff.filter((d) => d.type !== "unchanged");
  }, [diff]);

  const navigateToDiff = useCallback((direction: "prev" | "next") => {
    if (diffOnly.length === 0) return;

    if (direction === "prev") {
      setCurrentDiff((prev) => (prev > 0 ? prev - 1 : diffOnly.length - 1));
    } else {
      setCurrentDiff((prev) => (prev < diffOnly.length - 1 ? prev + 1 : 0));
    }
  }, [diffOnly.length]);

  const stripHtml = (html: string): string => {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "unified" | "split")}>
          <TabsList className="h-8">
            <TabsTrigger value="split" className="text-xs">
              <Columns className="h-3.5 w-3.5 mr-1" />
              Dividido
            </TabsTrigger>
            <TabsTrigger value="unified" className="text-xs">
              <GitCompare className="h-3.5 w-3.5 mr-1" />
              Unificado
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs">
          {stats.added > 0 && (
            <span className="text-green-600 dark:text-green-400">
              +{stats.added} añadidas
            </span>
          )}
          {stats.removed > 0 && (
            <span className="text-red-600 dark:text-red-400">
              -{stats.removed} eliminadas
            </span>
          )}
          <span className="text-muted-foreground">
            {stats.unchanged} sin cambios
          </span>
        </div>

        {/* Navigation */}
        {diffOnly.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigateToDiff("prev")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {currentDiff + 1} / {diffOnly.length} cambios
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigateToDiff("next")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "split" ? (
          <div className="grid grid-cols-2 h-full">
            {/* Left pane */}
            <div className="border-r border-border flex flex-col">
              <div className="px-3 py-1.5 bg-muted/50 border-b border-border text-xs font-medium flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                {leftTitle}
              </div>
              <ScrollArea className="flex-1">
                <div className="font-mono text-xs">
                  {diff.map((line, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex",
                        line.type === "removed" && "bg-red-100 dark:bg-red-900/30",
                        line.type === "added" && "opacity-30"
                      )}
                    >
                      <span className="w-12 px-2 py-0.5 text-muted-foreground text-right border-r border-border bg-muted/30 select-none">
                        {line.lineNumber.left || ""}
                      </span>
                      <span className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">
                        {line.content.left || ""}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Right pane */}
            <div className="flex flex-col">
              <div className="px-3 py-1.5 bg-muted/50 border-b border-border text-xs font-medium flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                {rightTitle}
              </div>
              <ScrollArea className="flex-1">
                <div className="font-mono text-xs">
                  {diff.map((line, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex",
                        line.type === "added" && "bg-green-100 dark:bg-green-900/30",
                        line.type === "removed" && "opacity-30"
                      )}
                    >
                      <span className="w-12 px-2 py-0.5 text-muted-foreground text-right border-r border-border bg-muted/30 select-none">
                        {line.lineNumber.right || ""}
                      </span>
                      <span className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">
                        {line.content.right || ""}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        ) : (
          // Unified view
          <ScrollArea className="h-full">
            <div className="font-mono text-xs">
              {diff.map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex",
                    line.type === "removed" && "bg-red-100 dark:bg-red-900/30",
                    line.type === "added" && "bg-green-100 dark:bg-green-900/30"
                  )}
                >
                  <span className="w-8 px-2 py-0.5 text-muted-foreground text-right border-r border-border bg-muted/30 select-none">
                    {line.lineNumber.left || ""}
                  </span>
                  <span className="w-8 px-2 py-0.5 text-muted-foreground text-right border-r border-border bg-muted/30 select-none">
                    {line.lineNumber.right || ""}
                  </span>
                  <span
                    className={cn(
                      "px-1 py-0.5",
                      line.type === "removed" && "text-red-700 dark:text-red-300",
                      line.type === "added" && "text-green-700 dark:text-green-300"
                    )}
                  >
                    {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
                  </span>
                  <span className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">
                    {line.content.left || line.content.right || ""}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

export default DocumentDiffViewer;
