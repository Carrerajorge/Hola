import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, Maximize2, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

interface ChatSpreadsheetViewerProps {
  uploadId: string;
  filename: string;
  sheets: SheetInfo[];
  initialSheet?: string;
  previewData?: { headers: string[]; data: any[][] };
  onAnalyze?: () => void;
  onDownload?: () => void;
  onExpand?: () => void;
}

interface SheetDataResponse {
  rows: Record<string, any>[];
  columns: { name: string; type: string }[];
  totalRows: number;
}

interface CachedSheetData {
  [sheetName: string]: SheetDataResponse;
}

export function ChatSpreadsheetViewer({
  uploadId,
  filename,
  sheets,
  initialSheet,
  previewData,
  onDownload,
  onExpand,
}: ChatSpreadsheetViewerProps) {
  const [activeSheet, setActiveSheet] = useState<string>(
    initialSheet || sheets[0]?.name || ''
  );
  const [cachedData, setCachedData] = useState<CachedSheetData>({});
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<SheetDataResponse>({
    queryKey: ['chatSheetData', uploadId, activeSheet],
    queryFn: async () => {
      if (cachedData[activeSheet]) {
        return cachedData[activeSheet];
      }
      const res = await fetch(
        `/api/spreadsheet/${uploadId}/sheet/${encodeURIComponent(activeSheet)}/data`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to fetch sheet data');
      }
      return res.json();
    },
    staleTime: 300000,
    enabled: !!activeSheet && !!uploadId,
  });

  useEffect(() => {
    if (data && activeSheet && !cachedData[activeSheet]) {
      setCachedData(prev => ({ ...prev, [activeSheet]: data }));
    }
  }, [data, activeSheet, cachedData]);

  const displayData = useMemo(() => {
    if (cachedData[activeSheet]) return cachedData[activeSheet];
    if (data) return data;
    if (previewData && activeSheet === (initialSheet || sheets[0]?.name)) {
      return {
        rows: previewData.data.map((row, idx) => {
          const rowObj: Record<string, any> = { __rowNum: idx + 1 };
          previewData.headers.forEach((header, colIdx) => {
            rowObj[header] = row[colIdx];
          });
          return rowObj;
        }),
        columns: previewData.headers.map(h => ({ name: h, type: 'text' })),
        totalRows: previewData.data.length,
      };
    }
    return null;
  }, [cachedData, activeSheet, data, previewData, initialSheet, sheets]);

  const columns = useMemo<ColumnDef<Record<string, any>>[]>(() => {
    if (!displayData?.columns) return [];

    const rowNumColumn: ColumnDef<Record<string, any>> = {
      id: '__rowNum',
      header: () => <span className="text-muted-foreground">#</span>,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs font-mono">
          {row.index + 1}
        </span>
      ),
      size: 40,
    };

    const dataColumns = displayData.columns.map((col) => ({
      id: col.name,
      accessorKey: col.name,
      header: () => (
        <span className="truncate text-xs font-medium">{col.name}</span>
      ),
      cell: ({ getValue }: { getValue: () => any }) => {
        const value = getValue();
        if (value === null || value === undefined || value === '') {
          return <span className="text-muted-foreground/50">—</span>;
        }
        return (
          <span className="truncate block text-xs max-w-[150px]">
            {String(value)}
          </span>
        );
      },
    }));

    return [rowNumColumn, ...dataColumns];
  }, [displayData?.columns]);

  const tableData = useMemo(() => {
    return displayData?.rows || [];
  }, [displayData?.rows]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const handleSheetChange = useCallback((sheetName: string) => {
    setActiveSheet(sheetName);
  }, []);

  const displayFilename = useMemo(() => {
    const maxLen = 35;
    if (filename.length <= maxLen) return filename;
    const ext = filename.split('.').pop() || '';
    const name = filename.slice(0, filename.length - ext.length - 1);
    const truncatedName = name.slice(0, maxLen - ext.length - 4) + '...';
    return `${truncatedName}.${ext}`;
  }, [filename]);

  return (
    <Card className="w-full max-w-2xl overflow-hidden border bg-card/50" data-testid="chat-spreadsheet-viewer">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span 
            className="text-sm font-medium truncate" 
            title={filename}
            data-testid="spreadsheet-filename"
          >
            {displayFilename}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {sheets.length > 1 && (
            <Select value={activeSheet} onValueChange={handleSheetChange}>
              <SelectTrigger 
                className="h-7 w-auto min-w-[100px] max-w-[150px] text-xs border-0 bg-transparent hover:bg-accent/50"
                data-testid="sheet-selector"
              >
                <SelectValue placeholder="Select sheet" />
              </SelectTrigger>
              <SelectContent>
                {sheets.map((sheet) => (
                  <SelectItem 
                    key={sheet.name} 
                    value={sheet.name}
                    className="text-xs"
                    data-testid={`sheet-option-${sheet.name}`}
                  >
                    {sheet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {sheets.length === 1 && (
            <span className="text-xs text-muted-foreground px-2">
              {sheets[0].name}
            </span>
          )}

          {onDownload && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onDownload}
              title="Download"
              data-testid="download-button"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}

          {onExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onExpand}
              title="Expand"
              data-testid="expand-button"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={tableContainerRef}
        className="max-h-[300px] overflow-auto scroll-smooth"
        data-testid="spreadsheet-table-container"
      >
        {isLoading && !displayData && (
          <div className="flex items-center justify-center h-[200px]">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Loading...</span>
            </div>
          </div>
        )}

        {error && !displayData && (
          <div className="flex items-center justify-center h-[200px]">
            <div className="flex flex-col items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-xs">{(error as Error).message}</span>
            </div>
          </div>
        )}

        {displayData && (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header, idx) => (
                    <th
                      key={header.id}
                      className={cn(
                        "text-left px-2 py-1.5 border-b font-medium whitespace-nowrap",
                        idx === 0 && "w-10 text-center bg-muted/90",
                        idx > 0 && "border-l border-border/50"
                      )}
                      style={header.column.getSize() ? { width: header.column.getSize() } : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: `${paddingTop}px` }} colSpan={columns.length} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    {row.getVisibleCells().map((cell, idx) => (
                      <td 
                        key={cell.id} 
                        className={cn(
                          "px-2 py-1 border-b border-border/30",
                          idx === 0 && "text-center bg-muted/20 border-r border-border/50",
                          idx > 0 && "border-l border-border/20"
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td style={{ height: `${paddingBottom}px` }} colSpan={columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        )}

        {displayData && displayData.rows.length === 0 && (
          <div className="flex items-center justify-center h-[100px] text-muted-foreground text-xs">
            No data in this sheet
          </div>
        )}
      </div>

      {displayData && displayData.totalRows > 0 && (
        <div className="px-3 py-1.5 border-t bg-muted/20 text-xs text-muted-foreground">
          {displayData.totalRows.toLocaleString()} rows × {displayData.columns?.length || 0} columns
        </div>
      )}
    </Card>
  );
}
