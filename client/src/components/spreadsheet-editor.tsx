import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  X,
  Download,
  Plus,
  Trash2,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  BarChart3,
  LineChart,
  PieChart,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart as RechartsLineChart, Line, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';

interface SpreadsheetEditorProps {
  title: string;
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onDownload: () => void;
  onInsertContent?: (insertFn: (content: string) => void) => void;
}

interface CellData {
  value: string;
  formula?: string;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
}

interface ChartConfig {
  type: 'bar' | 'line' | 'pie';
  visible: boolean;
  title?: string;
}

interface SpreadsheetData {
  cells: { [key: string]: CellData };
  rowCount: number;
  colCount: number;
}

interface SheetData {
  id: string;
  name: string;
  data: SpreadsheetData;
  chartConfig?: ChartConfig;
}

interface WorkbookData {
  sheets: SheetData[];
  activeSheetId: string;
}

const getColumnLabel = (index: number): string => {
  let label = '';
  let num = index;
  while (num >= 0) {
    label = String.fromCharCode(65 + (num % 26)) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
};

const getCellKey = (row: number, col: number): string => `${row}-${col}`;

const parseCellRef = (ref: string): { row: number; col: number } | null => {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const colStr = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10) - 1;
  let colNum = 0;
  for (let i = 0; i < colStr.length; i++) {
    colNum = colNum * 26 + (colStr.charCodeAt(i) - 64);
  }
  colNum -= 1;
  return { row: rowNum, col: colNum };
};

const parseRange = (range: string): Array<{ row: number; col: number }> => {
  const [start, end] = range.split(':');
  const startCell = parseCellRef(start);
  const endCell = end ? parseCellRef(end) : startCell;
  if (!startCell || !endCell) return [];
  const cells: Array<{ row: number; col: number }> = [];
  for (let r = Math.min(startCell.row, endCell.row); r <= Math.max(startCell.row, endCell.row); r++) {
    for (let c = Math.min(startCell.col, endCell.col); c <= Math.max(startCell.col, endCell.col); c++) {
      cells.push({ row: r, col: c });
    }
  }
  return cells;
};

const evaluateFormula = (formula: string, cells: { [key: string]: CellData }): string => {
  if (!formula.startsWith('=')) return formula;
  const expr = formula.substring(1).toUpperCase().trim();
  
  const getCellValue = (ref: string): number => {
    const parsed = parseCellRef(ref);
    if (!parsed) return 0;
    const cell = cells[getCellKey(parsed.row, parsed.col)];
    if (!cell) return 0;
    const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
    return isNaN(val) ? 0 : val;
  };
  
  const getRangeValues = (rangeStr: string): number[] => {
    const rangeCells = parseRange(rangeStr);
    return rangeCells.map(c => {
      const cell = cells[getCellKey(c.row, c.col)];
      if (!cell) return 0;
      const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
      return isNaN(val) ? 0 : val;
    });
  };
  
  const sumMatch = expr.match(/^SUM\(([^)]+)\)$/);
  if (sumMatch) {
    const values = getRangeValues(sumMatch[1]);
    return values.reduce((a, b) => a + b, 0).toString();
  }
  
  const avgMatch = expr.match(/^AVERAGE\(([^)]+)\)$/);
  if (avgMatch) {
    const values = getRangeValues(avgMatch[1]);
    if (values.length === 0) return '0';
    const sum = values.reduce((a, b) => a + b, 0);
    return (sum / values.length).toFixed(2);
  }
  
  const countMatch = expr.match(/^COUNT\(([^)]+)\)$/);
  if (countMatch) {
    const rangeCells = parseRange(countMatch[1]);
    let count = 0;
    rangeCells.forEach(c => {
      const cell = cells[getCellKey(c.row, c.col)];
      if (cell && cell.value.trim() !== '') count++;
    });
    return count.toString();
  }
  
  const minMatch = expr.match(/^MIN\(([^)]+)\)$/);
  if (minMatch) {
    const values = getRangeValues(minMatch[1]).filter(v => !isNaN(v));
    if (values.length === 0) return '0';
    return Math.min(...values).toString();
  }
  
  const maxMatch = expr.match(/^MAX\(([^)]+)\)$/);
  if (maxMatch) {
    const values = getRangeValues(maxMatch[1]).filter(v => !isNaN(v));
    if (values.length === 0) return '0';
    return Math.max(...values).toString();
  }
  
  const cellRefMatch = expr.match(/^([A-Z]+\d+)$/);
  if (cellRefMatch) {
    return getCellValue(cellRefMatch[1]).toString();
  }
  
  return '#ERROR';
};

const createEmptySheet = (id: string, name: string): SheetData => ({
  id,
  name,
  data: { cells: {}, rowCount: 20, colCount: 10 }
});

const parseSheetData = (content: string): SpreadsheetData => {
  if (content.includes('<table') && content.includes('</table>')) {
    const cells: { [key: string]: CellData } = {};
    let maxRow = 0;
    let maxCol = 0;
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const rows = doc.querySelectorAll('tbody tr');
    
    rows.forEach((row, rowIndex) => {
      const tds = row.querySelectorAll('td');
      tds.forEach((td, colIndex) => {
        const value = td.textContent?.trim() || '';
        if (value) {
          const style = td.getAttribute('style') || '';
          cells[getCellKey(rowIndex, colIndex)] = {
            value,
            bold: style.includes('font-weight: bold'),
            italic: style.includes('font-style: italic'),
            align: style.includes('text-align: right') ? 'right' : 
                   style.includes('text-align: center') ? 'center' : 'left'
          };
        }
        maxCol = Math.max(maxCol, colIndex);
      });
      maxRow = Math.max(maxRow, rowIndex);
    });

    return {
      cells,
      rowCount: Math.max(maxRow + 1, 20),
      colCount: Math.max(maxCol + 1, 10),
    };
  }

  const lines = content.split('\n').filter(line => line.trim());
  const cells: { [key: string]: CellData } = {};
  let maxCol = 0;

  lines.forEach((line, rowIndex) => {
    const values = line.split(/[,\t]/).map(v => v.trim());
    values.forEach((value, colIndex) => {
      if (value) {
        cells[getCellKey(rowIndex, colIndex)] = { value };
        maxCol = Math.max(maxCol, colIndex);
      }
    });
  });

  return {
    cells,
    rowCount: Math.max(lines.length, 20),
    colCount: Math.max(maxCol + 1, 10),
  };
};

const parseContent = (content: string): WorkbookData => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.sheets && Array.isArray(parsed.sheets)) {
      return parsed as WorkbookData;
    }
    if (parsed.cells && typeof parsed.rowCount === 'number') {
      return {
        sheets: [{ id: 'sheet1', name: 'Hoja 1', data: parsed }],
        activeSheetId: 'sheet1'
      };
    }
  } catch {}

  const sheetData = parseSheetData(content);
  return {
    sheets: [{ id: 'sheet1', name: 'Hoja 1', data: sheetData }],
    activeSheetId: 'sheet1'
  };
};

export function SpreadsheetEditor({
  title,
  content,
  onChange,
  onClose,
  onDownload,
  onInsertContent,
}: SpreadsheetEditorProps) {
  const [workbook, setWorkbook] = useState<WorkbookData>(() => parseContent(content));
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{start: string; end: string} | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const inputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const initialContentRef = useRef(content);
  const insertFnRegisteredRef = useRef(false);
  
  const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  // Get active sheet data
  const activeSheet = workbook.sheets.find(s => s.id === workbook.activeSheetId) || workbook.sheets[0];
  const data = activeSheet?.data || { cells: {}, rowCount: 20, colCount: 10 };

  // Extract chart data from spreadsheet
  const chartData = useMemo(() => {
    const result: Array<{ name: string; value: number; [key: string]: string | number }> = [];
    const headers: string[] = [];
    
    // Get headers from first row
    for (let c = 0; c < data.colCount; c++) {
      const cell = data.cells[getCellKey(0, c)];
      if (cell?.value) {
        headers[c] = cell.value;
      }
    }
    
    // Get data rows
    for (let r = 1; r < data.rowCount; r++) {
      const labelCell = data.cells[getCellKey(r, 0)];
      if (!labelCell?.value) continue;
      
      const row: { name: string; value: number; [key: string]: string | number } = {
        name: labelCell.value,
        value: 0
      };
      
      let hasNumericData = false;
      for (let c = 1; c < data.colCount; c++) {
        const cell = data.cells[getCellKey(r, c)];
        if (cell?.value) {
          const numVal = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
          if (!isNaN(numVal)) {
            const key = headers[c] || `col${c}`;
            row[key] = numVal;
            if (c === 1) row.value = numVal;
            hasNumericData = true;
          }
        }
      }
      
      if (hasNumericData) {
        result.push(row);
      }
    }
    
    return { data: result, headers: headers.filter((h, i) => i > 0 && h) };
  }, [data.cells, data.rowCount, data.colCount]);

  // Update active sheet data helper
  const setData = useCallback((updater: (prev: SpreadsheetData) => SpreadsheetData) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet => 
        sheet.id === prev.activeSheetId 
          ? { ...sheet, data: updater(sheet.data) }
          : sheet
      )
    }));
  }, []);

  // Sheet management functions
  const addSheet = useCallback(() => {
    const newId = `sheet${Date.now()}`;
    const sheetNum = workbook.sheets.length + 1;
    setWorkbook(prev => ({
      ...prev,
      sheets: [...prev.sheets, createEmptySheet(newId, `Hoja ${sheetNum}`)],
      activeSheetId: newId
    }));
  }, [workbook.sheets.length]);

  const switchSheet = useCallback((sheetId: string) => {
    setWorkbook(prev => {
      const newWorkbook = { ...prev, activeSheetId: sheetId };
      const targetSheet = newWorkbook.sheets.find(s => s.id === sheetId);
      if (targetSheet?.chartConfig?.visible) {
        setShowChart(true);
        setChartType(targetSheet.chartConfig.type);
      } else {
        setShowChart(false);
      }
      return newWorkbook;
    });
    setSelectedCell(null);
    setEditingCell(null);
  }, []);

  const renameSheet = useCallback((sheetId: string, newName: string) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(s => s.id === sheetId ? { ...s, name: newName } : s)
    }));
  }, []);

  const deleteSheet = useCallback((sheetId: string) => {
    if (workbook.sheets.length <= 1) return;
    setWorkbook(prev => {
      const newSheets = prev.sheets.filter(s => s.id !== sheetId);
      const newActiveId = prev.activeSheetId === sheetId ? newSheets[0].id : prev.activeSheetId;
      return { sheets: newSheets, activeSheetId: newActiveId };
    });
  }, [workbook.sheets.length]);

  useEffect(() => {
    if (content !== initialContentRef.current && content) {
      const newWorkbook = parseContent(content);
      setWorkbook(newWorkbook);
      initialContentRef.current = content;
    }
  }, [content]);

  const dataToHtml = useCallback((spreadsheetData: SpreadsheetData): string => {
    let html = '<table border="1" style="border-collapse: collapse; width: 100%;">';
    html += '<thead><tr>';
    for (let c = 0; c < spreadsheetData.colCount; c++) {
      html += `<th style="padding: 8px; background: #f0f0f0; font-weight: bold;">${getColumnLabel(c)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = 0; r < spreadsheetData.rowCount; r++) {
      html += '<tr>';
      for (let c = 0; c < spreadsheetData.colCount; c++) {
        const cell = spreadsheetData.cells[getCellKey(r, c)] || { value: '' };
        const style = [
          'padding: 6px',
          cell.bold ? 'font-weight: bold' : '',
          cell.italic ? 'font-style: italic' : '',
          cell.align ? `text-align: ${cell.align}` : ''
        ].filter(Boolean).join('; ');
        html += `<td style="${style}">${cell.value}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }, []);

  // Serialize workbook to JSON for storage
  useEffect(() => {
    const workbookJson = JSON.stringify(workbook);
    onChange(workbookJson);
  }, [workbook, onChange]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const insertContentFn = useCallback((text: string) => {
    // Clean markdown from text
    const cleanMarkdown = (str: string) => str
      .replace(/^\*\*[^*]+\*\*\s*/gm, '')
      .replace(/^-\s+\*\*([^*]+)\*\*:\s*/gm, '$1,')
      .replace(/^\s*-\s+/gm, '')
      .replace(/\[GRAFICO:[^\]]+\]/g, '')
      .trim();
    
    // Parse GRAFICO command from content
    const parseGraficoCommand = (content: string): ChartConfig | null => {
      const graficoMatch = content.match(/\[GRAFICO:(barras|lineas|pastel)\]/i);
      if (!graficoMatch) return null;
      const tipoMap: { [k: string]: 'bar' | 'line' | 'pie' } = {
        'barras': 'bar',
        'lineas': 'line',
        'pastel': 'pie'
      };
      return {
        type: tipoMap[graficoMatch[1].toLowerCase()] || 'bar',
        visible: true
      };
    };
    
    // Parse lines and insert into a sheet, handling formulas
    const insertLines = (lines: string[], sheetData: SpreadsheetData): SpreadsheetData => {
      const newCells = { ...sheetData.cells };
      let maxColInserted = 0;
      
      let startRow = 0;
      for (let r = 0; r < sheetData.rowCount; r++) {
        let rowHasData = false;
        for (let c = 0; c < sheetData.colCount; c++) {
          if (sheetData.cells[getCellKey(r, c)]?.value) {
            rowHasData = true;
            break;
          }
        }
        if (!rowHasData) {
          startRow = r;
          break;
        }
        startRow = r + 1;
      }
      
      lines.forEach((line, rowOffset) => {
        const values = line.split(/[,\t]/).map(v => v.trim());
        values.forEach((value, colOffset) => {
          if (value) {
            const key = getCellKey(startRow + rowOffset, colOffset);
            if (value.startsWith('=')) {
              newCells[key] = { value: value, formula: value };
            } else {
              newCells[key] = { value };
            }
            maxColInserted = Math.max(maxColInserted, colOffset);
          }
        });
      });
      
      // Evaluate formulas after all cells are inserted
      Object.keys(newCells).forEach(key => {
        const cell = newCells[key];
        if (cell.formula && cell.formula.startsWith('=')) {
          cell.value = evaluateFormula(cell.formula, newCells);
        }
      });
      
      return {
        ...sheetData,
        cells: newCells,
        rowCount: Math.max(sheetData.rowCount, startRow + lines.length + 1),
        colCount: Math.max(sheetData.colCount, maxColInserted + 1)
      };
    };
    
    // Check for chart command in text
    const chartConfig = parseGraficoCommand(text);
    
    // Check if there are sheet commands
    const hasSheetCommands = /\[(NUEVA_HOJA|HOJA):/.test(text);
    
    // If no sheet commands, insert into active sheet
    if (!hasSheetCommands) {
      const cleanText = cleanMarkdown(text);
      const lines = cleanText.split('\n').filter(line => line.trim());
      if (lines.length === 0 && !chartConfig) return;
      
      if (lines.length > 0) {
        setData(prev => insertLines(lines, prev));
      }
      
      // Apply chart config to active sheet
      if (chartConfig) {
        setWorkbook(prev => ({
          ...prev,
          sheets: prev.sheets.map(s => 
            s.id === prev.activeSheetId 
              ? { ...s, chartConfig } 
              : s
          )
        }));
        setShowChart(true);
        setChartType(chartConfig.type);
      }
      return;
    }
    
    // Parse sheet commands and their content using regex.exec
    const sheetCommandPattern = /\[(NUEVA_HOJA|HOJA):([^\]]+)\]/g;
    const commands: { type: string; name: string; startIndex: number; endIndex: number }[] = [];
    let match;
    
    while ((match = sheetCommandPattern.exec(text)) !== null) {
      commands.push({
        type: match[1],
        name: match[2].trim(),
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }
    
    // Pre-calculate chart configs for each command section
    const commandChartConfigs: (ChartConfig | null)[] = commands.map((cmd, idx) => {
      const contentStart = cmd.endIndex;
      const contentEnd = idx < commands.length - 1 ? commands[idx + 1].startIndex : text.length;
      const content = text.substring(contentStart, contentEnd);
      return parseGraficoCommand(content);
    });
    
    // Find the last chart config for showing after update
    let finalChartConfig: ChartConfig | null = null;
    for (let i = commandChartConfigs.length - 1; i >= 0; i--) {
      if (commandChartConfigs[i]) {
        finalChartConfig = commandChartConfigs[i];
        break;
      }
    }
    
    // Process multiple sheets
    setWorkbook(prev => {
      const newSheets: SheetData[] = prev.sheets.map(s => ({ ...s, data: { ...s.data, cells: { ...s.data.cells } } }));
      let newWorkbook: WorkbookData = { ...prev, sheets: newSheets };
      let lastSheetId = prev.activeSheetId;
      
      commands.forEach((cmd, idx) => {
        const contentStart = cmd.endIndex;
        const contentEnd = idx < commands.length - 1 ? commands[idx + 1].startIndex : text.length;
        const content = text.substring(contentStart, contentEnd);
        const sectionChartConfig = commandChartConfigs[idx];
        
        const cleanedText = cleanMarkdown(content);
        const lines = cleanedText.split('\n').filter(line => line.trim());
        
        if (cmd.type === 'NUEVA_HOJA') {
          const newId = `sheet${Date.now()}_${idx}`;
          const newSheet = createEmptySheet(newId, cmd.name);
          
          if (lines.length > 0) {
            newSheet.data = insertLines(lines, newSheet.data);
          }
          
          if (sectionChartConfig) {
            newSheet.chartConfig = sectionChartConfig;
          }
          
          newWorkbook.sheets.push(newSheet);
          lastSheetId = newId;
        } else if (cmd.type === 'HOJA') {
          const targetSheet = newWorkbook.sheets.find(s => s.name.toLowerCase() === cmd.name.toLowerCase());
          if (targetSheet) {
            const sheetIndex = newWorkbook.sheets.findIndex(s => s.id === targetSheet.id);
            if (sheetIndex >= 0) {
              if (lines.length > 0) {
                newWorkbook.sheets[sheetIndex].data = insertLines(lines, newWorkbook.sheets[sheetIndex].data);
              }
              if (sectionChartConfig) {
                newWorkbook.sheets[sheetIndex].chartConfig = sectionChartConfig;
              }
            }
            lastSheetId = targetSheet.id;
          }
        }
      });
      
      newWorkbook.activeSheetId = lastSheetId;
      return newWorkbook;
    });
    
    // Show chart if any sheet had chart config
    if (finalChartConfig) {
      setShowChart(true);
      setChartType(finalChartConfig.type);
    }
  }, [setData]);

  useEffect(() => {
    if (onInsertContent && !insertFnRegisteredRef.current) {
      onInsertContent(insertContentFn);
      insertFnRegisteredRef.current = true;
    }
  }, [onInsertContent, insertContentFn]);

  const updateCell = useCallback((key: string, updates: Partial<CellData>) => {
    setData(prev => ({
      ...prev,
      cells: {
        ...prev.cells,
        [key]: { ...prev.cells[key], value: '', ...updates },
      },
    }));
  }, []);

  const handleCellClick = useCallback((key: string) => {
    setSelectedCell(key);
    setSelectionRange(null);
  }, []);

  const handleCellDoubleClick = useCallback((key: string) => {
    setEditingCell(key);
    setSelectedCell(key);
  }, []);

  const handleCellChange = useCallback((key: string, value: string) => {
    if (value.startsWith('=')) {
      const computedValue = evaluateFormula(value, data.cells);
      updateCell(key, { value: computedValue, formula: value });
    } else {
      updateCell(key, { value, formula: undefined });
    }
  }, [updateCell, data.cells]);

  const handleCellBlur = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, key: string) => {
    const [row, col] = key.split('-').map(Number);
    
    if (e.key === 'Enter') {
      e.preventDefault();
      setEditingCell(null);
      const nextKey = getCellKey(row + 1, col);
      setSelectedCell(nextKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setEditingCell(null);
      const nextKey = getCellKey(row, col + 1);
      setSelectedCell(nextKey);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, []);

  const handleNavigationKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedCell || editingCell) return;
    
    const [row, col] = selectedCell.split('-').map(Number);
    let newRow = row;
    let newCol = col;

    switch (e.key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        break;
      case 'ArrowDown':
        newRow = Math.min(data.rowCount - 1, row + 1);
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        break;
      case 'ArrowRight':
        newCol = Math.min(data.colCount - 1, col + 1);
        break;
      case 'Enter':
        setEditingCell(selectedCell);
        e.preventDefault();
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setEditingCell(selectedCell);
          updateCell(selectedCell, { value: e.key });
        }
        return;
    }

    e.preventDefault();
    setSelectedCell(getCellKey(newRow, newCol));
  }, [selectedCell, editingCell, data.rowCount, data.colCount, updateCell]);

  const addRow = useCallback(() => {
    setData(prev => ({ ...prev, rowCount: prev.rowCount + 1 }));
  }, []);

  const addColumn = useCallback(() => {
    setData(prev => ({ ...prev, colCount: prev.colCount + 1 }));
  }, []);

  const deleteRow = useCallback(() => {
    if (!selectedCell) return;
    const [row] = selectedCell.split('-').map(Number);
    setData(prev => {
      const newCells: { [key: string]: CellData } = {};
      Object.entries(prev.cells).forEach(([key, cell]) => {
        const [r, c] = key.split('-').map(Number);
        if (r < row) {
          newCells[key] = cell;
        } else if (r > row) {
          newCells[getCellKey(r - 1, c)] = cell;
        }
      });
      return { ...prev, cells: newCells, rowCount: Math.max(1, prev.rowCount - 1) };
    });
    setSelectedCell(null);
  }, [selectedCell]);

  const deleteColumn = useCallback(() => {
    if (!selectedCell) return;
    const [, col] = selectedCell.split('-').map(Number);
    setData(prev => {
      const newCells: { [key: string]: CellData } = {};
      Object.entries(prev.cells).forEach(([key, cell]) => {
        const [r, c] = key.split('-').map(Number);
        if (c < col) {
          newCells[key] = cell;
        } else if (c > col) {
          newCells[getCellKey(r, c - 1)] = cell;
        }
      });
      return { ...prev, cells: newCells, colCount: Math.max(1, prev.colCount - 1) };
    });
    setSelectedCell(null);
  }, [selectedCell]);

  const toggleBold = useCallback(() => {
    if (!selectedCell) return;
    const cell = data.cells[selectedCell] || { value: '' };
    updateCell(selectedCell, { ...cell, bold: !cell.bold });
  }, [selectedCell, data.cells, updateCell]);

  const toggleItalic = useCallback(() => {
    if (!selectedCell) return;
    const cell = data.cells[selectedCell] || { value: '' };
    updateCell(selectedCell, { ...cell, italic: !cell.italic });
  }, [selectedCell, data.cells, updateCell]);

  const setAlignment = useCallback((align: 'left' | 'center' | 'right') => {
    if (!selectedCell) return;
    const cell = data.cells[selectedCell] || { value: '' };
    updateCell(selectedCell, { ...cell, align });
  }, [selectedCell, data.cells, updateCell]);

  const updateChartConfig = useCallback((type: 'bar' | 'line' | 'pie', visible: boolean) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(s => 
        s.id === prev.activeSheetId 
          ? { ...s, chartConfig: { type, visible, title: s.chartConfig?.title } } 
          : s
      )
    }));
    setChartType(type);
    setShowChart(visible);
  }, []);

  const hideChart = useCallback(() => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(s => 
        s.id === prev.activeSheetId && s.chartConfig
          ? { ...s, chartConfig: { ...s.chartConfig, visible: false } } 
          : s
      )
    }));
    setShowChart(false);
  }, []);

  // Recalculate formulas when cells change
  const recalculateFormulas = useCallback(() => {
    setData(prev => {
      const newCells = { ...prev.cells };
      let changed = false;
      Object.keys(newCells).forEach(key => {
        const cell = newCells[key];
        if (cell.formula && cell.formula.startsWith('=')) {
          const newValue = evaluateFormula(cell.formula, newCells);
          if (newValue !== cell.value) {
            newCells[key] = { ...cell, value: newValue };
            changed = true;
          }
        }
      });
      return changed ? { ...prev, cells: newCells } : prev;
    });
  }, [setData]);

  // Recalculate formulas when data changes
  useEffect(() => {
    const hasFormulas = Object.values(data.cells).some(cell => cell.formula);
    if (hasFormulas) {
      recalculateFormulas();
    }
  }, [data.cells, recalculateFormulas]);

  // Auto-show chart on initial load if chartConfig.visible is true
  useEffect(() => {
    if (activeSheet?.chartConfig?.visible) {
      setShowChart(true);
      setChartType(activeSheet.chartConfig.type);
    }
  }, []);

  const selectedCellData = selectedCell ? data.cells[selectedCell] : null;
  const selectedCellLabel = selectedCell 
    ? `${getColumnLabel(parseInt(selectedCell.split('-')[1]))}${parseInt(selectedCell.split('-')[0]) + 1}`
    : '';

  return (
    <div 
      className="spreadsheet-editor flex flex-col h-full bg-white dark:bg-black"
      onKeyDown={handleNavigationKeyDown}
      tabIndex={0}
    >
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Descargar
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
        {/* Cell Reference */}
        <div className="w-16 px-2 py-1 text-xs font-mono bg-white dark:bg-black border rounded text-center">
          {selectedCellLabel}
        </div>
        
        {/* Formula Bar */}
        <input
          ref={formulaInputRef}
          type="text"
          className="flex-1 max-w-md px-3 py-1 text-sm border rounded bg-white dark:bg-black focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
          placeholder="Ingresa un valor o fórmula"
          value={selectedCellData?.formula || selectedCellData?.value || ''}
          onChange={(e) => selectedCell && handleCellChange(selectedCell, e.target.value)}
        />

        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2" />

        {/* Formatting */}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', selectedCellData?.bold && 'bg-gray-200 dark:bg-gray-800')}
          onClick={toggleBold}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', selectedCellData?.italic && 'bg-gray-200 dark:bg-gray-800')}
          onClick={toggleItalic}
        >
          <Italic className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2" />

        {/* Alignment */}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', selectedCellData?.align === 'left' && 'bg-gray-200 dark:bg-gray-800')}
          onClick={() => setAlignment('left')}
        >
          <AlignLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', selectedCellData?.align === 'center' && 'bg-gray-200 dark:bg-gray-800')}
          onClick={() => setAlignment('center')}
        >
          <AlignCenter className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', selectedCellData?.align === 'right' && 'bg-gray-200 dark:bg-gray-800')}
          onClick={() => setAlignment('right')}
        >
          <AlignRight className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2" />

        {/* Row/Column Actions */}
        <Button variant="ghost" size="sm" onClick={addRow} className="gap-1 text-xs">
          <Plus className="h-3 w-3" /> Fila
        </Button>
        <Button variant="ghost" size="sm" onClick={addColumn} className="gap-1 text-xs">
          <Plus className="h-3 w-3" /> Columna
        </Button>
        <Button variant="ghost" size="sm" onClick={deleteRow} disabled={!selectedCell} className="gap-1 text-xs text-red-600">
          <Trash2 className="h-3 w-3" /> Fila
        </Button>
        <Button variant="ghost" size="sm" onClick={deleteColumn} disabled={!selectedCell} className="gap-1 text-xs text-red-600">
          <Trash2 className="h-3 w-3" /> Col
        </Button>

        <div className="h-6 w-px bg-gray-300 dark:bg-gray-700 mx-2" />

        {/* Chart Controls */}
        <Button
          variant={showChart && chartType === 'bar' ? 'default' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={() => updateChartConfig('bar', true)}
          title="Gráfico de barras"
          data-testid="btn-bar-chart"
        >
          <BarChart3 className="h-4 w-4" />
        </Button>
        <Button
          variant={showChart && chartType === 'line' ? 'default' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={() => updateChartConfig('line', true)}
          title="Gráfico de líneas"
          data-testid="btn-line-chart"
        >
          <LineChart className="h-4 w-4" />
        </Button>
        <Button
          variant={showChart && chartType === 'pie' ? 'default' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={() => updateChartConfig('pie', true)}
          title="Gráfico circular"
          data-testid="btn-pie-chart"
        >
          <PieChart className="h-4 w-4" />
        </Button>
        {showChart && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-gray-500"
            onClick={hideChart}
          >
            Ocultar
          </Button>
        )}
      </div>

      {/* Chart Panel */}
      {showChart && chartData.data.length > 0 && (
        <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black p-4" style={{ height: '280px' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Gráfico: {activeSheet?.name}</h3>
            <span className="text-xs text-gray-500">{chartData.data.length} registros</span>
          </div>
          <ResponsiveContainer width="100%" height="90%">
            {chartType === 'bar' ? (
              <BarChart data={chartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }} 
                />
                {chartData.headers.length > 0 ? (
                  chartData.headers.map((header, i) => (
                    <Bar key={header} dataKey={header} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                  ))
                ) : (
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            ) : chartType === 'line' ? (
              <RechartsLineChart data={chartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }} 
                />
                {chartData.headers.length > 0 ? (
                  chartData.headers.map((header, i) => (
                    <Line key={header} type="monotone" dataKey={header} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ fill: CHART_COLORS[i % CHART_COLORS.length] }} />
                  ))
                ) : (
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                )}
              </RechartsLineChart>
            ) : (
              <RechartsPieChart>
                <Pie
                  data={chartData.data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#9ca3af' }}
                >
                  {chartData.data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }} 
                />
              </RechartsPieChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {showChart && chartData.data.length === 0 && (
        <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-6 text-center">
          <BarChart3 className="h-12 w-12 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">Agrega datos numéricos para ver el gráfico</p>
          <p className="text-xs text-gray-400 mt-1">Primera columna: etiquetas, siguientes columnas: valores</p>
        </div>
      )}

      {/* Spreadsheet Grid */}
      <div className="flex-1 overflow-auto">
        <table className="spreadsheet-table border-collapse w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              {/* Corner cell */}
              <th className="spreadsheet-corner-cell" />
              {/* Column headers */}
              {Array.from({ length: data.colCount }, (_, i) => (
                <th key={i} className="spreadsheet-col-header">
                  {getColumnLabel(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: data.rowCount }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {/* Row header */}
                <td className="spreadsheet-row-header">
                  {rowIndex + 1}
                </td>
                {/* Data cells */}
                {Array.from({ length: data.colCount }, (_, colIndex) => {
                  const key = getCellKey(rowIndex, colIndex);
                  const cell = data.cells[key] || { value: '' };
                  const isSelected = selectedCell === key;
                  const isEditing = editingCell === key;

                  return (
                    <td
                      key={colIndex}
                      className={cn(
                        'spreadsheet-cell',
                        isSelected && 'spreadsheet-cell-selected',
                        cell.bold && 'font-bold',
                        cell.italic && 'italic'
                      )}
                      style={{ textAlign: cell.align || 'left' }}
                      onClick={() => handleCellClick(key)}
                      onDoubleClick={() => handleCellDoubleClick(key)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="text"
                          className="spreadsheet-cell-input"
                          value={cell.value}
                          onChange={(e) => handleCellChange(key, e.target.value)}
                          onBlur={handleCellBlur}
                          onKeyDown={(e) => handleKeyDown(e, key)}
                        />
                      ) : (
                        <span className="spreadsheet-cell-content">{cell.value}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sheet Tabs */}
      <div className="flex items-center border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center gap-1 px-2 py-1 overflow-x-auto flex-1">
          {workbook.sheets.map(sheet => (
            <button
              key={sheet.id}
              onClick={() => switchSheet(sheet.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-t border-x border-t transition-colors whitespace-nowrap',
                sheet.id === workbook.activeSheetId
                  ? 'bg-white dark:bg-black border-gray-300 dark:border-gray-700 font-medium'
                  : 'bg-gray-100 dark:bg-gray-900 border-transparent hover:bg-gray-200 dark:hover:bg-gray-800'
              )}
            >
              {sheet.name}
              {workbook.sheets.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); deleteSheet(sheet.id); }}
                  className="ml-2 text-gray-400 hover:text-red-500 cursor-pointer"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            onClick={addSheet}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Agregar hoja"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-1 text-xs text-gray-500 border-l border-gray-200 dark:border-gray-800">
          {data.rowCount} × {data.colCount}
        </div>
      </div>
    </div>
  );
}
