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
  columnWidths?: { [col: number]: number };
  rowHeights?: { [row: number]: number };
  onColumnWidthChange?: (col: number, width: number) => void;
  onRowHeightChange?: (row: number, height: number) => void;
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
    textDecoration: data.underline ? 'underline' : 'none',
    fontFamily: data.fontFamily || 'inherit',
    fontSize: data.fontSize ? `${data.fontSize}px` : 'inherit',
    textAlign: data.align || 'left',
    backgroundColor: conditionalStyle?.backgroundColor || data.backgroundColor || data.format?.backgroundColor,
    color: conditionalStyle?.color || data.color || data.format?.textColor,
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
  const displayNumber = row + 1;
  return (
    <div
      className="absolute flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 select-none"
      style={style}
      data-testid={`row-header-${row}`}
      title={`Fila ${displayNumber}`}
    >
      {displayNumber}
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
  columnWidths,
  rowHeights,
  onColumnWidthChange,
  onRowHeightChange,
}: VirtualizedExcelProps) {
  void version;
  void onColumnWidthChange;
  void onRowHeightChange;
  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number | null>(null);
  const formulaEngine = useRef(new FormulaEngine(grid));

  useEffect(() => {
    formulaEngine.current.setGrid(grid);
  }, [grid]);

  const getColumnWidth = useCallback((col: number) => columnWidths?.[col] || GRID_CONFIG.COL_WIDTH, [columnWidths]);
  const getRowHeight = useCallback((row: number) => rowHeights?.[row] || GRID_CONFIG.ROW_HEIGHT, [rowHeights]);

  const positionCache = useMemo(() => {
    const colCache = new Map<number, number>();
    const rowCache = new Map<number, number>();
    
    return {
      getColumnLeft: (col: number): number => {
        if (col === 0) return 0;
        if (colCache.has(col)) return colCache.get(col)!;
        
        let startCol = 0;
        let startPos = 0;
        for (let i = col - 1; i >= 0; i--) {
          if (colCache.has(i)) {
            startCol = i;
            startPos = colCache.get(i)!;
            break;
          }
        }
        
        let pos = startPos;
        for (let i = startCol; i < col; i++) {
          pos += columnWidths?.[i] ?? GRID_CONFIG.COL_WIDTH;
        }
        colCache.set(col, pos);
        return pos;
      },
      getRowTop: (row: number): number => {
        if (row === 0) return 0;
        if (rowCache.has(row)) return rowCache.get(row)!;
        
        let startRow = 0;
        let startPos = 0;
        for (let i = row - 1; i >= 0; i--) {
          if (rowCache.has(i)) {
            startRow = i;
            startPos = rowCache.get(i)!;
            break;
          }
        }
        
        let pos = startPos;
        for (let i = startRow; i < row; i++) {
          pos += rowHeights?.[i] ?? GRID_CONFIG.ROW_HEIGHT;
        }
        rowCache.set(row, pos);
        return pos;
      }
    };
  }, [columnWidths, rowHeights]);

  const getColumnLeft = positionCache.getColumnLeft;
  const getRowTop = positionCache.getRowTop;

  const findRowAtPosition = useCallback((scrollTop: number): number => {
    let cumulative = 0;
    for (let r = 0; r < GRID_CONFIG.MAX_ROWS; r++) {
      const height = rowHeights?.[r] ?? GRID_CONFIG.ROW_HEIGHT;
      if (cumulative + height > scrollTop) {
        return r;
      }
      cumulative += height;
    }
    return GRID_CONFIG.MAX_ROWS - 1;
  }, [rowHeights]);

  const findColAtPosition = useCallback((scrollLeft: number): number => {
    let cumulative = 0;
    for (let c = 0; c < GRID_CONFIG.MAX_COLS; c++) {
      const width = columnWidths?.[c] ?? GRID_CONFIG.COL_WIDTH;
      if (cumulative + width > scrollLeft) {
        return c;
      }
      cumulative += width;
    }
    return GRID_CONFIG.MAX_COLS - 1;
  }, [columnWidths]);

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

  const calculatedStartRow = findRowAtPosition(scrollPos.top);
  const startRow = Math.max(0, calculatedStartRow - GRID_CONFIG.BUFFER_ROWS);
  const startCol = Math.max(0, findColAtPosition(scrollPos.left) - GRID_CONFIG.BUFFER_COLS);
  const endRow = Math.min(GRID_CONFIG.MAX_ROWS, startRow + GRID_CONFIG.VISIBLE_ROWS + GRID_CONFIG.BUFFER_ROWS * 2);
  const endCol = Math.min(GRID_CONFIG.MAX_COLS, startCol + GRID_CONFIG.VISIBLE_COLS + GRID_CONFIG.BUFFER_COLS * 2);
  
  // Debug logging
  useEffect(() => {
    console.log('VirtualizedExcel Debug:', {
      scrollTop: scrollPos.top,
      calculatedStartRow,
      startRow,
      endRow,
      visibleRowsCount: endRow - startRow,
      firstVisibleRow: startRow,
      lastVisibleRow: endRow - 1
    });
  }, [scrollPos.top, calculatedStartRow, startRow, endRow]);

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
    if (typeof row !== 'number' || typeof col !== 'number' || isNaN(row) || isNaN(col)) {
      console.warn('Invalid cell coordinates in handleCellChange:', row, col);
      return;
    }
    if (row < 0 || row >= GRID_CONFIG.MAX_ROWS || col < 0 || col >= GRID_CONFIG.MAX_COLS) {
      console.warn('Cell coordinates out of bounds:', row, col);
      return;
    }
    try {
      updateCell(row, col, value);
    } catch (e) {
      console.error('Failed to change cell:', e);
    }
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
    if (typeof row !== 'number' || typeof col !== 'number' || isNaN(row) || isNaN(col)) {
      console.warn('Invalid selected cell coordinates:', selectedCell);
      return;
    }
    
    let newRow = row;
    let newCol = col;

    try {
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

      if (newRow < 0 || newRow >= GRID_CONFIG.MAX_ROWS || newCol < 0 || newCol >= GRID_CONFIG.MAX_COLS) {
        console.warn('Navigation target out of bounds:', newRow, newCol);
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
    } catch (e) {
      console.error('Error handling keyboard navigation:', e);
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

  const totalWidth = useMemo(() => {
    let width = 0;
    for (let c = 0; c < GRID_CONFIG.MAX_COLS; c++) {
      width += columnWidths?.[c] || GRID_CONFIG.COL_WIDTH;
    }
    return width;
  }, [columnWidths]);

  const totalHeight = useMemo(() => {
    let height = 0;
    for (let r = 0; r < GRID_CONFIG.MAX_ROWS; r++) {
      height += rowHeights?.[r] || GRID_CONFIG.ROW_HEIGHT;
    }
    return height;
  }, [rowHeights]);

  return (
    <div
      className={cn("flex flex-col h-full w-full overflow-hidden bg-white dark:bg-gray-900 outline-none", className)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      data-testid="virtualized-excel"
    >
      <div className="flex flex-1 overflow-hidden">
        <div
          className="flex-shrink-0 bg-gray-100 dark:bg-gray-800 flex flex-col"
          style={{ width: GRID_CONFIG.ROW_HEADER_WIDTH }}
        >
          <div
            className="flex-shrink-0 z-20 bg-gray-200 dark:bg-gray-700 border-r border-b border-gray-300 dark:border-gray-600"
            style={{ height: GRID_CONFIG.COL_HEADER_HEIGHT, width: GRID_CONFIG.ROW_HEADER_WIDTH }}
          />
          <div
            className="flex-1 relative overflow-hidden"
          >
            <div 
              style={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: totalHeight,
                transform: `translateY(-${scrollPos.top}px)`,
              }}
            >
              {visibleRows.map(row => (
                <RowHeader
                  key={row}
                  row={row}
                  style={{
                    position: 'absolute',
                    top: getRowTop(row),
                    left: 0,
                    width: GRID_CONFIG.ROW_HEADER_WIDTH,
                    height: getRowHeight(row),
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
                    left: getColumnLeft(col),
                    width: getColumnWidth(col),
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
                  const cellData = grid.getCell(row, col) || { value: '' };
                  const safeData = {
                    value: cellData.value ?? '',
                    formula: cellData.formula,
                    bold: cellData.bold,
                    italic: cellData.italic,
                    underline: cellData.underline,
                    align: cellData.align,
                    fontFamily: cellData.fontFamily,
                    fontSize: cellData.fontSize,
                    color: cellData.color,
                    backgroundColor: cellData.backgroundColor,
                    format: cellData.format,
                  };
                  const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                  const isEditing = editingCell?.row === row && editingCell?.col === col;

                  const isStreamingCell = activeStreamingCell?.row === row && activeStreamingCell?.col === col;
                  const isRecentlyWritten = isRecentCell(row, col);
                  const conditionalStyle = getConditionalStyle(row, col, safeData.value);
                  
                  return (
                    <VirtualCell
                      key={`${row}:${col}`}
                      row={row}
                      col={col}
                      data={safeData}
                      isSelected={isSelected}
                      isEditing={isEditing}
                      isStreaming={isStreamingCell}
                      isRecentlyWritten={isRecentlyWritten}
                      typingValue={isStreamingCell ? typingValue : undefined}
                      style={{
                        top: getRowTop(row),
                        left: getColumnLeft(col),
                        width: getColumnWidth(col),
                        height: getRowHeight(row),
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
