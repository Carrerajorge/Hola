import { useState, useCallback, useRef, useEffect } from 'react';
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
} from 'lucide-react';

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
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
}

interface SpreadsheetData {
  cells: { [key: string]: CellData };
  rowCount: number;
  colCount: number;
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

const parseContent = (content: string): SpreadsheetData => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.cells && typeof parsed.rowCount === 'number') {
      return parsed;
    }
  } catch {}

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

export function SpreadsheetEditor({
  title,
  content,
  onChange,
  onClose,
  onDownload,
  onInsertContent,
}: SpreadsheetEditorProps) {
  const [data, setData] = useState<SpreadsheetData>(() => parseContent(content));
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{start: string; end: string} | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const initialContentRef = useRef(content);

  useEffect(() => {
    if (content !== initialContentRef.current && content) {
      const newData = parseContent(content);
      setData(newData);
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

  useEffect(() => {
    const htmlContent = dataToHtml(data);
    onChange(htmlContent);
  }, [data, onChange, dataToHtml]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  useEffect(() => {
    if (onInsertContent) {
      const insertContent = (text: string) => {
        console.log('[SpreadsheetEditor] insertContent called with:', text.substring(0, 100));
        
        // Clean markdown formatting if present
        let cleanText = text
          .replace(/^\*\*[^*]+\*\*\s*/gm, '') // Remove **Title**
          .replace(/^-\s+\*\*([^*]+)\*\*:\s*/gm, '$1,') // Convert - **Year**: value to Year,value
          .replace(/^\s*-\s+/gm, '') // Remove leading dashes
          .trim();
        
        const lines = cleanText.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
          console.log('[SpreadsheetEditor] No lines to insert');
          return;
        }
        
        console.log('[SpreadsheetEditor] Inserting', lines.length, 'lines');
        
        setData(prev => {
          const newCells = { ...prev.cells };
          let maxColInserted = 0;
          
          // Find first empty row to append data
          let startRow = 0;
          for (let r = 0; r < prev.rowCount; r++) {
            let rowHasData = false;
            for (let c = 0; c < prev.colCount; c++) {
              if (prev.cells[getCellKey(r, c)]?.value) {
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
                newCells[getCellKey(startRow + rowOffset, colOffset)] = { value };
                maxColInserted = Math.max(maxColInserted, colOffset);
              }
            });
          });
          
          console.log('[SpreadsheetEditor] Data updated, rows:', startRow + lines.length);
          
          return {
            ...prev,
            cells: newCells,
            rowCount: Math.max(prev.rowCount, startRow + lines.length + 1),
            colCount: Math.max(prev.colCount, maxColInserted + 1)
          };
        });
      };
      onInsertContent(insertContent);
      console.log('[SpreadsheetEditor] Insert function registered');
    }
  }, [onInsertContent]);

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
    updateCell(key, { value });
  }, [updateCell]);

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
          value={selectedCellData?.value || ''}
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
      </div>

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

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-xs text-gray-500">
        <span>{data.rowCount} filas × {data.colCount} columnas</span>
        <span>Haga doble clic para editar</span>
      </div>
    </div>
  );
}
