/**
 * Virtualized Table Component
 * 
 * Renderiza tablas grandes con virtual scrolling para rendimiento óptimo.
 * Solo renderiza las filas visibles en el viewport.
 */

import React, { useMemo, useCallback, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, Copy, Check, Search, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VirtualizedTableProps {
  headers: string[];
  rows: string[][];
  maxHeight?: number;
  rowHeight?: number;
  overscan?: number;
  fileName?: string;
  onExport?: () => void;
}

type SortDirection = "asc" | "desc" | null;

export function VirtualizedTable({
  headers,
  rows,
  maxHeight = 400,
  rowHeight = 32,
  overscan = 10,
  fileName,
  onExport,
}: VirtualizedTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [copied, setCopied] = useState(false);
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Filter rows based on search
  const filteredRows = useMemo(() => {
    if (!searchTerm) return rows;

    const term = searchTerm.toLowerCase();
    return rows.filter((row) =>
      row.some((cell) => cell.toLowerCase().includes(term))
    );
  }, [rows, searchTerm]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (sortColumn === null || !sortDirection) return filteredRows;

    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortColumn] || "";
      const bVal = b[sortColumn] || "";

      // Try numeric comparison
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
      }

      // String comparison
      const comparison = aVal.localeCompare(bVal);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredRows, sortColumn, sortDirection]);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const handleSort = useCallback((columnIndex: number) => {
    setSortColumn((prev) => {
      if (prev === columnIndex) {
        setSortDirection((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
        return d === "desc" ? null : columnIndex;
      }
      setSortDirection("asc");
      return columnIndex;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    const text = [headers.join("\t"), ...sortedRows.map((row) => row.join("\t"))].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [headers, sortedRows]);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport();
      return;
    }

    // Default CSV export
    const csv = [headers.join(","), ...sortedRows.map((row) => row.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName ? `${fileName.replace(/\.[^.]+$/, "")}.csv` : "table.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [headers, sortedRows, fileName, onExport]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border bg-muted/30">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar en tabla..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        <span className="text-xs text-muted-foreground">
          {sortedRows.length.toLocaleString()} filas
          {searchTerm && filteredRows.length !== rows.length && ` (filtrado de ${rows.length.toLocaleString()})`}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copiar
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copiar al portapapeles</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Exportar
              </Button>
            </TooltipTrigger>
            <TooltipContent>Descargar como CSV</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Table container */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        style={{ maxHeight }}
      >
        <table className="w-full border-collapse">
          {/* Header */}
          <thead className="sticky top-0 bg-muted z-10">
            <tr>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className="px-3 py-2 text-left text-xs font-medium border-b border-r border-border cursor-pointer hover:bg-muted/80 select-none"
                  onClick={() => handleSort(index)}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate max-w-[150px]">{header}</span>
                    {sortColumn === index && (
                      sortDirection === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Virtualized body */}
          <tbody
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const row = sortedRows[virtualRow.index];
              if (!row) return null;

              return (
                <tr
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    "hover:bg-muted/50 transition-colors",
                    virtualRow.index % 2 === 0 ? "bg-background" : "bg-muted/20"
                  )}
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="px-3 py-1 text-xs border-r border-border truncate max-w-[200px]"
                      title={cell}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer with stats */}
      <div className="flex items-center justify-between px-3 py-1 text-xs text-muted-foreground border-t border-border bg-muted/30">
        <span>
          Mostrando {virtualItems.length} de {sortedRows.length.toLocaleString()} filas
        </span>
        {sortColumn !== null && (
          <button
            onClick={() => {
              setSortColumn(null);
              setSortDirection(null);
            }}
            className="text-primary hover:underline"
          >
            Limpiar ordenamiento
          </button>
        )}
      </div>
    </div>
  );
}

export default VirtualizedTable;
