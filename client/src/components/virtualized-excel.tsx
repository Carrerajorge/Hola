import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import { SparseGrid, getColumnName, formatCellRef, CellData } from '@/lib/sparseGrid';
import { FormulaEngine } from '@/lib/formulaEngine';
import { ChartLayer, ChartConfig as ChartLayerConfig } from './excel-chart-layer';

const GRID_CONFIG = {
  MAX_ROWS: 10000,
  MAX_COLS: 10000,
  ROW_HEIGHT: 28,
  COL_WIDTH: 100,
  ROW_HEADER_WIDTH: 60,
  COL_HEADER_HEIGHT: 28,
  VISIBLE_ROWS: 35,
  VISIBLE_COLS: 20,
  BUFFER_ROWS: 5,
  BUFFER_COLS: 3,
};

interface ConditionalFormatRule {
  condition: 'greaterThan' | 'lessThan' | 'equals' | 'between';
  value?: number;
  min?: number;
  max?: number;
  style: { backgroundColor?: string; color?: string; };
}

interface ConditionalFormat {
  range: { startRow: number; endRow: number; startCol: number; endCol: number };
  rules: ConditionalFormatRule[];
}

interface VirtualizedExcelProps {
  grid: SparseGrid;
  onGridChange: (grid: SparseGrid) => void;
  selectedCell: { row: number; col: number } | null;
  onSelectCell: (cell: { row: number; col: number } | null) => void;
  editingCell: { row: number; col: number } | null;
  onEditCell: (cell: { row: number; col: number } | null) => void;
  className?: string;
  version?: number;
  activeStreamingCell?: { row: number; col: number } | null;
  typingValue?: string;
  isRecentCell?: (row: number, col: number) => boolean;
  conditionalFormats?: ConditionalFormat[];
  charts?: ChartLayerConfig[];
  onUpdateChart?: (chartId: string, updates: Partial<ChartLayerConfig>) => void;
  onDeleteChart?: (chartId: string) => void;
}

const VirtualCell = memo(function VirtualCell({
  row,
  col,
  data,
  isSelected,
  isEditing,
  isStreaming,
  isRecentlyWritten,
  typingValue,
  style,
  conditionalStyle,
  onMouseDown,
  onDoubleClick,
  onBlur,
  onChange,
  onKeyDown,
}: {
  row: number;
  col: number;
  data: CellData;
  isSelected: boolean;
  isEditing: boolean;
  isStreaming: boolean;
  isRecentlyWritten: boolean;
  typingValue?: string;
  style: React.CSSProperties;
  conditionalStyle?: React.CSSProperties;
  onMouseDown: () => void;
  onDoubleClick: () => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const cellStyle: React.CSSProperties = {
    ...style,
    fontWeight: data.bold ? 'bold' : 'normal',
    fontStyle: data.italic ? 'italic' : 'normal',
    textAlign: data.align || 'left',
    backgroundColor: conditionalStyle?.backgroundColor || data.format?.backgroundColor,
    color: conditionalStyle?.color || data.format?.textColor,
  };

  return (
    <div
      className={cn(
        "absolute border-r border-b border-gray-200 dark:border-gray-700 px-1.5 flex items-center text-sm select-none overflow-hidden whitespace-nowrap transition-all duration-200",
        isSelected && !isEditing && "ring-2 ring-blue-500 ring-inset z-10 bg-blue-50 dark:bg-blue-950",
        isStreaming && "ring-2 ring-purple-500 ring-inset z-20 bg-purple-50 dark:bg-purple-950",
        isRecentlyWritten && "animate-flash-green bg-green-100 dark:bg-green-900",
        data.value && !isStreaming && !isRecentlyWritten && "bg-white dark:bg-gray-900",
        !data.value && !isSelected && !isStreaming && "bg-gray-50/50 dark:bg-gray-900/50"
      )}
      style={cellStyle}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      data-testid={`cell-${row}-${col}`}
      data-row={row}
      data-col={col}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          defaultValue={data.formula || data.value}
          className="w-full h-full bg-white dark:bg-gray-900 outline-none text-sm px-0.5"
          onBlur={(e) => {
            onChange(e.target.value);
            onBlur();
          }}
          onKeyDown={onKeyDown}
          data-testid={`cell-input-${row}-${col}`}
        />
      ) : isStreaming && typingValue ? (
        <span className="truncate font-mono text-purple-700 dark:text-purple-300">
          {typingValue}
          <span className="inline-block w-0.5 h-4 bg-purple-500 animate-blink ml-0.5" />
        </span>
      ) : (
        <span className="truncate">{data.value}</span>
      )}
    </div>
  );
});

const ColumnHeader = memo(function ColumnHeader({
  col,
  style,
}: {
  col: number;
  style: React.CSSProperties;
}) {
  return (
    <div
      className="absolute flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 select-none"
      style={style}
      data-testid={`col-header-${col}`}
    >
      {getColumnName(col)}
    </div>
  );
});

const RowHeader = memo(function RowHeader({
  row,
  style,
}: {
  row: number;
  style: React.CSSProperties;
}) {
  return (
    <div
      className="absolute flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 select-none"
      style={style}
      data-testid={`row-header-${row}`}
    >
      {row + 1}
    </div>
  );
});

export function VirtualizedExcel({
  grid,
  onGridChange,
  selectedCell,
  onSelectCell,
  editingCell,
  onEditCell,
  className,
  version = 0,
  activeStreamingCell = null,
  typingValue = '',
  isRecentCell = () => false,
  conditionalFormats,
  charts = [],
  onUpdateChart,
  onDeleteChart,
}: VirtualizedExcelProps) {
  void version;
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number | null>(null);
  const formulaEngine = useRef(new FormulaEngine(grid));

  useEffect(() => {
    formulaEngine.current.setGrid(grid);
  }, [grid]);

  const getConditionalStyle = useCallback((row: number, col: number, value: string | number): React.CSSProperties => {
    if (!conditionalFormats) return {};
    
    const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, ''));
    if (isNaN(numValue)) return {};
    
    for (const format of conditionalFormats) {
      const { range, rules } = format;
      if (row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol) {
        for (const rule of rules) {
          let matches = false;
          switch (rule.condition) {
            case 'greaterThan':
              matches = numValue > (rule.value ?? 0);
              break;
            case 'lessThan':
              matches = numValue < (rule.value ?? 0);
              break;
            case 'equals':
              matches = numValue === rule.value;
              break;
            case 'between':
              matches = numValue >= (rule.min ?? -Infinity) && numValue <= (rule.max ?? Infinity);
              break;
          }
          if (matches) {
            return {
              backgroundColor: rule.style.backgroundColor,
              color: rule.style.color
            };
          }
        }
      }
    }
    return {};
  }, [conditionalFormats]);

  const startRow = Math.max(0, Math.floor(scrollPos.top / GRID_CONFIG.ROW_HEIGHT) - GRID_CONFIG.BUFFER_ROWS);
  const startCol = Math.max(0, Math.floor(scrollPos.left / GRID_CONFIG.COL_WIDTH) - GRID_CONFIG.BUFFER_COLS);
  const endRow = Math.min(GRID_CONFIG.MAX_ROWS, startRow + GRID_CONFIG.VISIBLE_ROWS + GRID_CONFIG.BUFFER_ROWS * 2);
  const endCol = Math.min(GRID_CONFIG.MAX_COLS, startCol + GRID_CONFIG.VISIBLE_COLS + GRID_CONFIG.BUFFER_COLS * 2);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (scrollRAF.current) {
      cancelAnimationFrame(scrollRAF.current);
    }
    scrollRAF.current = requestAnimationFrame(() => {
      setScrollPos({ top: target.scrollTop, left: target.scrollLeft });
    });
  }, []);

  const updateCell = useCallback((row: number, col: number, value: string) => {
    if (value.startsWith('=')) {
      const evaluated = formulaEngine.current.evaluate(value);
      grid.setCell(row, col, { value: evaluated, formula: value });
    } else {
      grid.setCell(row, col, { value, formula: undefined });
    }
    
    onGridChange(grid);
  }, [grid, onGridChange]);

  const handleCellSelect = useCallback((row: number, col: number) => {
    onSelectCell({ row, col });
  }, [onSelectCell]);

  const handleCellEdit = useCallback((row: number, col: number) => {
    onEditCell({ row, col });
    onSelectCell({ row, col });
  }, [onEditCell, onSelectCell]);

  const handleCellBlur = useCallback(() => {
    onEditCell(null);
  }, [onEditCell]);

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    updateCell(row, col, value);
  }, [updateCell]);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEditCell(null);
      onSelectCell({ row: Math.min(row + 1, GRID_CONFIG.MAX_ROWS - 1), col });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onEditCell(null);
      onSelectCell({ row, col: Math.min(col + 1, GRID_CONFIG.MAX_COLS - 1) });
    } else if (e.key === 'Escape') {
      onEditCell(null);
    }
  }, [onEditCell, onSelectCell]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedCell || editingCell) return;

    const { row, col } = selectedCell;
    let newRow = row;
    let newCol = col;

    switch (e.key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        e.preventDefault();
        break;
      case 'ArrowDown':
        newRow = Math.min(GRID_CONFIG.MAX_ROWS - 1, row + 1);
        e.preventDefault();
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        newCol = Math.min(GRID_CONFIG.MAX_COLS - 1, col + 1);
        e.preventDefault();
        break;
      case 'Enter':
        onEditCell({ row, col });
        e.preventDefault();
        return;
      case 'Delete':
      case 'Backspace':
        updateCell(row, col, '');
        e.preventDefault();
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          onEditCell({ row, col });
          grid.setCell(row, col, { value: e.key });
          onGridChange(grid);
          e.preventDefault();
        }
        return;
    }

    onSelectCell({ row: newRow, col: newCol });

    if (viewportRef.current) {
      const cellTop = newRow * GRID_CONFIG.ROW_HEIGHT;
      const cellLeft = newCol * GRID_CONFIG.COL_WIDTH;
      const viewportWidth = viewportRef.current.clientWidth - GRID_CONFIG.ROW_HEADER_WIDTH;
      const viewportHeight = viewportRef.current.clientHeight - GRID_CONFIG.COL_HEADER_HEIGHT;

      if (cellTop < scrollPos.top) {
        viewportRef.current.scrollTop = cellTop;
      } else if (cellTop + GRID_CONFIG.ROW_HEIGHT > scrollPos.top + viewportHeight) {
        viewportRef.current.scrollTop = cellTop + GRID_CONFIG.ROW_HEIGHT - viewportHeight;
      }

      if (cellLeft < scrollPos.left) {
        viewportRef.current.scrollLeft = cellLeft;
      } else if (cellLeft + GRID_CONFIG.COL_WIDTH > scrollPos.left + viewportWidth) {
        viewportRef.current.scrollLeft = cellLeft + GRID_CONFIG.COL_WIDTH - viewportWidth;
      }
    }
  }, [selectedCell, editingCell, scrollPos, grid, onGridChange, onEditCell, onSelectCell, updateCell]);

  const visibleRows = useMemo(() => {
    const rows: number[] = [];
    for (let r = startRow; r < endRow; r++) {
      rows.push(r);
    }
    return rows;
  }, [startRow, endRow]);

  const visibleCols = useMemo(() => {
    const cols: number[] = [];
    for (let c = startCol; c < endCol; c++) {
      cols.push(c);
    }
    return cols;
  }, [startCol, endCol]);

  const totalWidth = GRID_CONFIG.MAX_COLS * GRID_CONFIG.COL_WIDTH;
  const totalHeight = GRID_CONFIG.MAX_ROWS * GRID_CONFIG.ROW_HEIGHT;

  return (
    <div
      className={cn("flex flex-col h-full w-full overflow-hidden bg-white dark:bg-gray-900 outline-none", className)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="virtualized-excel"
    >
      <div className="flex flex-1 overflow-hidden">
        <div
          className="flex-shrink-0 bg-gray-100 dark:bg-gray-800"
          style={{ width: GRID_CONFIG.ROW_HEADER_WIDTH }}
        >
          <div
            className="sticky top-0 z-20 bg-gray-200 dark:bg-gray-700 border-r border-b border-gray-300 dark:border-gray-600"
            style={{ height: GRID_CONFIG.COL_HEADER_HEIGHT, width: GRID_CONFIG.ROW_HEADER_WIDTH }}
          />
          <div
            className="relative overflow-hidden"
            style={{
              height: `calc(100% - ${GRID_CONFIG.COL_HEADER_HEIGHT}px)`,
              transform: `translateY(-${scrollPos.top}px)`,
            }}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              {visibleRows.map(row => (
                <RowHeader
                  key={row}
                  row={row}
                  style={{
                    top: row * GRID_CONFIG.ROW_HEIGHT,
                    left: 0,
                    width: GRID_CONFIG.ROW_HEADER_WIDTH,
                    height: GRID_CONFIG.ROW_HEIGHT,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex-shrink-0 bg-gray-100 dark:bg-gray-800 overflow-hidden"
            style={{ height: GRID_CONFIG.COL_HEADER_HEIGHT }}
          >
            <div
              className="relative"
              style={{
                width: totalWidth,
                height: GRID_CONFIG.COL_HEADER_HEIGHT,
                transform: `translateX(-${scrollPos.left}px)`,
              }}
            >
              {visibleCols.map(col => (
                <ColumnHeader
                  key={col}
                  col={col}
                  style={{
                    top: 0,
                    left: col * GRID_CONFIG.COL_WIDTH,
                    width: GRID_CONFIG.COL_WIDTH,
                    height: GRID_CONFIG.COL_HEADER_HEIGHT,
                  }}
                />
              ))}
            </div>
          </div>

          <div
            ref={viewportRef}
            className="flex-1 overflow-auto"
            onScroll={handleScroll}
            data-testid="excel-viewport"
          >
            <div
              style={{
                width: totalWidth,
                height: totalHeight,
                position: 'relative',
              }}
            >
              {visibleRows.map(row =>
                visibleCols.map(col => {
                  const cellData = grid.getCell(row, col);
                  const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                  const isEditing = editingCell?.row === row && editingCell?.col === col;

                  const isStreamingCell = activeStreamingCell?.row === row && activeStreamingCell?.col === col;
                  const isRecentlyWritten = isRecentCell(row, col);
                  const conditionalStyle = getConditionalStyle(row, col, cellData.value);
                  
                  return (
                    <VirtualCell
                      key={`${row}:${col}`}
                      row={row}
                      col={col}
                      data={cellData}
                      isSelected={isSelected}
                      isEditing={isEditing}
                      isStreaming={isStreamingCell}
                      isRecentlyWritten={isRecentlyWritten}
                      typingValue={isStreamingCell ? typingValue : undefined}
                      style={{
                        top: row * GRID_CONFIG.ROW_HEIGHT,
                        left: col * GRID_CONFIG.COL_WIDTH,
                        width: GRID_CONFIG.COL_WIDTH,
                        height: GRID_CONFIG.ROW_HEIGHT,
                      }}
                      conditionalStyle={conditionalStyle}
                      onMouseDown={() => handleCellSelect(row, col)}
                      onDoubleClick={() => handleCellEdit(row, col)}
                      onBlur={handleCellBlur}
                      onChange={(value) => handleCellChange(row, col, value)}
                      onKeyDown={(e) => handleCellKeyDown(e, row, col)}
                    />
                  );
                })
              )}
              
              {charts && charts.length > 0 && onUpdateChart && onDeleteChart && (
                <ChartLayer
                  charts={charts}
                  grid={grid}
                  gridConfig={GRID_CONFIG}
                  onUpdateChart={onUpdateChart}
                  onDeleteChart={onDeleteChart}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between">
        <span>
          {selectedCell
            ? `Celda: ${formatCellRef(selectedCell.row, selectedCell.col)}`
            : 'Selecciona una celda'}
        </span>
        <span>
          Datos: {grid.getCellCount().toLocaleString()} celdas | 
          Capacidad: {(GRID_CONFIG.MAX_ROWS * GRID_CONFIG.MAX_COLS).toLocaleString()} celdas
        </span>
      </div>
    </div>
  );
}

export { GRID_CONFIG };
export type { VirtualizedExcelProps, ConditionalFormat, ConditionalFormatRule };
