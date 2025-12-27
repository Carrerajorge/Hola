import React, { useState, useCallback, useRef, useEffect } from 'react';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import Handsontable from 'handsontable';
import 'handsontable/dist/handsontable.full.min.css';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { 
  Download, Upload, Plus, Trash2, Save, FileSpreadsheet, 
  Table, BarChart3, Calculator, Filter, SortAsc, Search,
  Undo, Redo, Copy, Clipboard, Scissors, Bold, Italic,
  AlignLeft, AlignCenter, AlignRight, Palette, Grid3X3, Type
} from 'lucide-react';
import '../../styles/spreadsheet.css';
import { useSpreadsheetStreaming } from './useSpreadsheetStreaming';
import { AICommandBar } from './AICommandBar';
import { StreamingIndicator } from './StreamingIndicator';

registerAllModules();

interface SpreadsheetEditorProps {
  initialData?: any[][];
  fileName?: string;
  onSave?: (data: any[][], fileName: string) => void;
  readOnly?: boolean;
  height?: number;
}

function generateEmptySheet(rows: number, cols: number): any[][] {
  return Array(rows).fill(null).map(() => Array(cols).fill(''));
}

function getColumnHeaders(count: number): string[] {
  const headers: string[] = [];
  for (let i = 0; i < count; i++) {
    let header = '';
    let num = i;
    while (num >= 0) {
      header = String.fromCharCode(65 + (num % 26)) + header;
      num = Math.floor(num / 26) - 1;
    }
    headers.push(header);
  }
  return headers;
}

export function SpreadsheetEditor({ 
  initialData, 
  fileName = 'spreadsheet.xlsx',
  onSave,
  readOnly = false,
  height = 600 
}: SpreadsheetEditorProps) {
  const hotRef = useRef<any>(null);
  const [data, setData] = useState<any[][]>(initialData || generateEmptySheet(50, 26));
  const [currentFileName, setCurrentFileName] = useState(fileName);
  const [sheets, setSheets] = useState<{ name: string; data: any[][] }[]>([
    { name: 'Hoja 1', data: initialData || generateEmptySheet(50, 26) }
  ]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [history, setHistory] = useState<any[][][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [formulaValue, setFormulaValue] = useState('');

  const [cellFormat, setCellFormat] = useState({
    bold: false,
    italic: false,
    align: 'left' as 'left' | 'center' | 'right',
    backgroundColor: '',
    textColor: ''
  });
  const [selectedRange, setSelectedRange] = useState<{ startRow: number; startCol: number; endRow: number; endCol: number } | null>(null);
  const [isAIProcessing, setIsAIProcessing] = useState(false);

  const { 
    isStreaming, 
    streamingCell, 
    streamToCell, 
    streamToCells, 
    streamFillColumn, 
    streamFillRange, 
    cancelStreaming 
  } = useSpreadsheetStreaming(hotRef, setIsModified);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setSheets([{ name: 'Hoja 1', data: initialData }]);
    }
  }, [initialData]);

  const updateFormatState = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    
    if (!selected || selected.length === 0) return;
    
    const [row, col] = [selected[0][0], selected[0][1]];
    const meta = hot.getCellMeta(row, col);
    
    setCellFormat({
      bold: meta.bold || false,
      italic: meta.italic || false,
      align: (meta.alignment as 'left' | 'center' | 'right') || 'left',
      backgroundColor: meta.backgroundColor || '',
      textColor: meta.textColor || ''
    });
  }, []);

  const applyBold = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    
    if (!selected || selected.length === 0) return;
    
    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          const meta = hot.getCellMeta(row, col);
          const newBold = !meta.bold;
          hot.setCellMeta(row, col, 'bold', newBold);
        }
      }
    });
    
    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyItalic = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    
    if (!selected || selected.length === 0) return;
    
    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          const meta = hot.getCellMeta(row, col);
          const newItalic = !meta.italic;
          hot.setCellMeta(row, col, 'italic', newItalic);
        }
      }
    });
    
    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyAlignment = useCallback((alignment: 'left' | 'center' | 'right') => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    
    if (!selected || selected.length === 0) return;
    
    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          hot.setCellMeta(row, col, 'alignment', alignment);
        }
      }
    });
    
    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyBackgroundColor = useCallback((color: string) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    
    if (!selected || selected.length === 0) return;
    
    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          hot.setCellMeta(row, col, 'backgroundColor', color);
        }
      }
    });
    
    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyTextColor = useCallback((color: string) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    
    if (!selected || selected.length === 0) return;
    
    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          hot.setCellMeta(row, col, 'textColor', color);
        }
      }
    });
    
    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        applyBold();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        applyItalic();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyBold, applyItalic]);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const importedSheets = workbook.SheetNames.map(name => {
          const worksheet = workbook.Sheets[name];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          return { name, data: jsonData as any[][] };
        });
        
        setSheets(importedSheets);
        setActiveSheet(0);
        setData(importedSheets[0].data);
        setCurrentFileName(file.name);
        setIsModified(false);
      } catch (error) {
        console.error('Error al importar:', error);
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  }, []);

  const handleExport = useCallback((format: 'xlsx' | 'csv' = 'xlsx') => {
    const workbook = XLSX.utils.book_new();
    
    sheets.forEach(sheet => {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });
    
    if (format === 'xlsx') {
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, currentFileName.endsWith('.xlsx') ? currentFileName : `${currentFileName}.xlsx`);
    } else {
      const csvData = XLSX.utils.sheet_to_csv(workbook.Sheets[sheets[activeSheet].name]);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
      saveAs(blob, currentFileName.replace('.xlsx', '.csv'));
    }
  }, [sheets, activeSheet, currentFileName]);

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave(data, currentFileName);
    }
    setIsModified(false);
  }, [data, currentFileName, onSave]);

  const handleDataChange = useCallback((changes: any, source: string) => {
    if (source === 'loadData') return;
    
    setIsModified(true);
    
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(data)));
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [data, history, historyIndex]);

  const handleUndo = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      hotRef.current.hotInstance.undo();
    }
  }, []);

  const handleRedo = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      hotRef.current.hotInstance.redo();
    }
  }, []);

  const handleCut = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      const plugin = hotRef.current.hotInstance.getPlugin('CopyPaste');
      plugin?.cut();
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      const plugin = hotRef.current.hotInstance.getPlugin('CopyPaste');
      plugin?.copy();
    }
  }, []);

  const handlePaste = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      const plugin = hotRef.current.hotInstance.getPlugin('CopyPaste');
      plugin?.paste();
    }
  }, []);

  const addSheet = useCallback(() => {
    const newSheet = {
      name: `Hoja ${sheets.length + 1}`,
      data: generateEmptySheet(50, 26)
    };
    setSheets([...sheets, newSheet]);
    setActiveSheet(sheets.length);
    setData(newSheet.data);
  }, [sheets]);

  const removeSheet = useCallback((index: number) => {
    if (sheets.length <= 1) return;
    const newSheets = sheets.filter((_, i) => i !== index);
    setSheets(newSheets);
    const newActiveSheet = Math.min(activeSheet, newSheets.length - 1);
    setActiveSheet(newActiveSheet);
    setData(newSheets[newActiveSheet].data);
  }, [sheets, activeSheet]);

  const switchSheet = useCallback((index: number) => {
    const updatedSheets = [...sheets];
    updatedSheets[activeSheet] = { ...updatedSheets[activeSheet], data };
    setSheets(updatedSheets);
    
    setActiveSheet(index);
    setData(updatedSheets[index].data);
  }, [sheets, activeSheet, data]);

  const insertRow = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    if (selected) {
      hot.alter('insert_row_below', selected[0][0]);
    }
  }, []);

  const insertColumn = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    if (selected) {
      hot.alter('insert_col_end', selected[0][1]);
    }
  }, []);

  const deleteRow = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    if (selected) {
      hot.alter('remove_row', selected[0][0]);
    }
  }, []);

  const handleSelection = useCallback((row: number, col: number, row2: number, col2: number) => {
    setSelectedCell({ row, col });
    setSelectedRange({
      startRow: Math.min(row, row2),
      startCol: Math.min(col, col2),
      endRow: Math.max(row, row2),
      endCol: Math.max(col, col2)
    });
    if (hotRef.current?.hotInstance) {
      const value = hotRef.current.hotInstance.getDataAtCell(row, col);
      setFormulaValue(value || '');
    }
  }, []);

  const handleAICommand = useCallback(async (command: string) => {
    setIsAIProcessing(true);
    try {
      const response = await fetch('/api/ai/excel-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          selectedRange,
          currentData: data
        })
      });

      if (!response.ok) {
        throw new Error('Failed to process AI command');
      }

      const result = await response.json();
      
      if (result.cells && result.cells.length > 0) {
        await streamToCells(result.cells);
      } else if (result.columnData) {
        await streamFillColumn(
          result.columnData.col, 
          result.columnData.values, 
          result.columnData.startRow || 0
        );
      } else if (result.rangeData) {
        await streamFillRange(
          result.rangeData.startRow,
          result.rangeData.startCol,
          result.rangeData.data
        );
      } else if (result.cell) {
        await streamToCell(result.cell.row, result.cell.col, result.cell.value);
      }
    } catch (error) {
      console.error('AI command error:', error);
    } finally {
      setIsAIProcessing(false);
    }
  }, [selectedRange, data, streamToCell, streamToCells, streamFillColumn, streamFillRange]);

  const handleSelectionEnd = useCallback(() => {
    updateFormatState();
  }, [updateFormatState]);

  const getCellReference = useCallback(() => {
    if (!selectedCell) return 'A1';
    return `${getColumnHeaders(26)[selectedCell.col] || 'A'}${selectedCell.row + 1}`;
  }, [selectedCell]);

  const customRendererRef = useRef((
    instance: Handsontable,
    td: HTMLTableCellElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: Handsontable.CellProperties
  ) => {
    Handsontable.renderers.TextRenderer(instance, td, row, col, prop, value, cellProperties);
    
    const meta = instance.getCellMeta(row, col);
    
    if (meta.bold) {
      td.style.fontWeight = 'bold';
    }
    if (meta.italic) {
      td.style.fontStyle = 'italic';
    }
    if (meta.alignment) {
      td.style.textAlign = meta.alignment as string;
    }
    if (meta.backgroundColor) {
      td.style.backgroundColor = meta.backgroundColor as string;
    }
    if (meta.textColor) {
      td.style.color = meta.textColor as string;
    }
  });

  const hotSettings = {
    data,
    rowHeaders: true,
    colHeaders: getColumnHeaders(26),
    height,
    width: '100%',
    licenseKey: 'non-commercial-and-evaluation',
    contextMenu: true,
    manualColumnResize: true,
    manualRowResize: true,
    filters: true,
    dropdownMenu: true,
    multiColumnSorting: true,
    mergeCells: true,
    comments: true,
    customBorders: true,
    copyPaste: true,
    fillHandle: true,
    undo: true,
    readOnly,
    afterChange: handleDataChange,
    afterSelection: handleSelection,
    afterSelectionEnd: handleSelectionEnd,
    renderer: customRendererRef.current,
    className: 'spreadsheet-dark-theme',
    stretchH: 'all' as const
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden border border-gray-700" data-testid="spreadsheet-editor">
      <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-1 pr-2 border-r border-gray-600">
          <label className="p-2 hover:bg-gray-700 rounded cursor-pointer transition-colors" title="Importar Excel" data-testid="button-import">
            <Upload className="w-4 h-4 text-gray-300" />
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" />
          </label>
          <button onClick={() => handleExport('xlsx')} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Exportar XLSX" data-testid="button-export-xlsx">
            <Download className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={() => handleExport('csv')} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Exportar CSV" data-testid="button-export-csv">
            <FileSpreadsheet className="w-4 h-4 text-gray-300" />
          </button>
          {onSave && (
            <button 
              onClick={handleSave} 
              className={`p-2 rounded transition-colors ${isModified ? 'bg-indigo-600 hover:bg-indigo-500' : 'hover:bg-gray-700'}`}
              title="Guardar"
              data-testid="button-save"
            >
              <Save className="w-4 h-4 text-white" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button onClick={handleUndo} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Deshacer (Ctrl+Z)" data-testid="button-undo">
            <Undo className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={handleRedo} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Rehacer (Ctrl+Y)" data-testid="button-redo">
            <Redo className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button onClick={handleCut} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Cortar" data-testid="button-cut">
            <Scissors className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={handleCopy} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Copiar" data-testid="button-copy">
            <Copy className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={handlePaste} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Pegar" data-testid="button-paste">
            <Clipboard className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button onClick={insertRow} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Insertar Fila" data-testid="button-insert-row">
            <Plus className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={insertColumn} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Insertar Columna" data-testid="button-insert-column">
            <Grid3X3 className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={deleteRow} className="p-2 hover:bg-gray-700 rounded transition-colors text-red-400" title="Eliminar Fila" data-testid="button-delete-row">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button 
            onClick={applyBold} 
            className={`p-2 rounded transition-colors ${cellFormat.bold ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Negrita (Ctrl+B)" 
            data-testid="button-bold"
          >
            <Bold className={`w-4 h-4 ${cellFormat.bold ? 'text-white' : 'text-gray-300'}`} />
          </button>
          <button 
            onClick={applyItalic}
            className={`p-2 rounded transition-colors ${cellFormat.italic ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Cursiva (Ctrl+I)" 
            data-testid="button-italic"
          >
            <Italic className={`w-4 h-4 ${cellFormat.italic ? 'text-white' : 'text-gray-300'}`} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button 
            onClick={() => applyAlignment('left')}
            className={`p-2 rounded transition-colors ${cellFormat.align === 'left' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Alinear Izquierda" 
            data-testid="button-align-left"
          >
            <AlignLeft className={`w-4 h-4 ${cellFormat.align === 'left' ? 'text-white' : 'text-gray-300'}`} />
          </button>
          <button 
            onClick={() => applyAlignment('center')}
            className={`p-2 rounded transition-colors ${cellFormat.align === 'center' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Centrar" 
            data-testid="button-align-center"
          >
            <AlignCenter className={`w-4 h-4 ${cellFormat.align === 'center' ? 'text-white' : 'text-gray-300'}`} />
          </button>
          <button 
            onClick={() => applyAlignment('right')}
            className={`p-2 rounded transition-colors ${cellFormat.align === 'right' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Alinear Derecha" 
            data-testid="button-align-right"
          >
            <AlignRight className={`w-4 h-4 ${cellFormat.align === 'right' ? 'text-white' : 'text-gray-300'}`} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <div className="relative" title="Color de Fondo">
            <button 
              className={`p-2 rounded transition-colors ${cellFormat.backgroundColor ? 'ring-2 ring-indigo-500' : 'hover:bg-gray-700'}`}
              style={{ backgroundColor: cellFormat.backgroundColor || undefined }}
              data-testid="button-bg-color"
            >
              <Palette className="w-4 h-4 text-gray-300" />
            </button>
            <input 
              type="color" 
              onChange={(e) => applyBackgroundColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Color de Fondo"
              data-testid="input-bg-color"
            />
          </div>
          <div className="relative" title="Color de Texto">
            <button 
              className={`p-2 rounded transition-colors ${cellFormat.textColor ? 'ring-2 ring-indigo-500' : 'hover:bg-gray-700'}`}
              data-testid="button-text-color"
            >
              <Type className="w-4 h-4" style={{ color: cellFormat.textColor || '#d1d5db' }} />
            </button>
            <input 
              type="color" 
              onChange={(e) => applyTextColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Color de Texto"
              data-testid="input-text-color"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 px-2">
          <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Filtrar" data-testid="button-filter">
            <Filter className="w-4 h-4 text-gray-300" />
          </button>
          <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Ordenar" data-testid="button-sort">
            <SortAsc className="w-4 h-4 text-gray-300" />
          </button>
          <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Buscar" data-testid="button-search">
            <Search className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={currentFileName}
            onChange={(e) => setCurrentFileName(e.target.value)}
            className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-indigo-500"
            placeholder="nombre-archivo.xlsx"
            data-testid="input-filename"
          />
          {isModified && <span className="text-yellow-400 text-xs" data-testid="text-modified-indicator">● Sin guardar</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-gray-850 border-b border-gray-700">
        <div className="flex items-center gap-2 px-2 py-1 bg-gray-700 rounded min-w-[80px]">
          <span className="text-xs text-gray-400" data-testid="text-cell-reference">
            {getCellReference()}
          </span>
        </div>
        <div className="flex items-center gap-2 px-2">
          <Calculator className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-400">fx</span>
        </div>
        <input
          type="text"
          value={formulaValue}
          onChange={(e) => setFormulaValue(e.target.value)}
          className="flex-1 px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-indigo-500"
          placeholder="Ingresa fórmula o valor..."
          data-testid="input-formula"
        />
      </div>

      <AICommandBar 
        onExecute={handleAICommand}
        isProcessing={isAIProcessing || isStreaming}
        selectedRange={selectedRange}
      />

      <div className="flex-1 overflow-hidden spreadsheet-container">
        <HotTable ref={hotRef} settings={hotSettings} />
      </div>

      <div className="flex items-center gap-1 p-2 bg-gray-800 border-t border-gray-700 overflow-x-auto">
        {sheets.map((sheet, index) => (
          <div
            key={index}
            className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer transition-colors ${
              activeSheet === index 
                ? 'bg-indigo-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            onClick={() => switchSheet(index)}
            data-testid={`tab-sheet-${index}`}
          >
            <Table className="w-3 h-3" />
            <span className="text-sm">{sheet.name}</span>
            {sheets.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); removeSheet(index); }}
                className="p-0.5 hover:bg-gray-500 rounded"
                data-testid={`button-remove-sheet-${index}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addSheet}
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="Añadir hoja"
          data-testid="button-add-sheet"
        >
          <Plus className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <StreamingIndicator 
        isStreaming={isStreaming}
        cell={streamingCell}
        onCancel={cancelStreaming}
      />
    </div>
  );
}

export default SpreadsheetEditor;
