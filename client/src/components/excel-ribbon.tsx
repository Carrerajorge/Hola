import React, { useState, useRef, useEffect, useCallback } from 'react';

const RIBBON_TABS = [
  { id: 'home', label: 'Inicio' },
  { id: 'insert', label: 'Insertar' },
  { id: 'draw', label: 'Dibujar' },
  { id: 'pageLayout', label: 'Disposición de página' },
  { id: 'formulas', label: 'Fórmulas' },
  { id: 'data', label: 'Datos' },
  { id: 'review', label: 'Revisar' },
  { id: 'view', label: 'Vista' },
  { id: 'automate', label: 'Automatizar' }
] as const;

type TabId = typeof RIBBON_TABS[number]['id'];

const Icons = {
  paste: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  cut: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  formatPainter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 3H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
      <path d="M12 11v8" />
      <path d="M8 21h8" />
    </svg>
  ),
  alignLeft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </svg>
  ),
  alignCenter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  ),
  alignRight: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="6" y1="18" x2="21" y2="18" />
    </svg>
  ),
  merge: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  ),
  wrapText: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
      <polyline points="14 16 12 18 14 20" />
      <line x1="3" y1="18" x2="10" y2="18" />
    </svg>
  ),
  borders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
    </svg>
  ),
  conditionalFormat: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" fill="#ef4444" />
      <rect x="14" y="3" width="7" height="7" fill="#f59e0b" />
      <rect x="3" y="14" width="7" height="7" fill="#10b981" />
      <rect x="14" y="14" width="7" height="7" fill="#3b82f6" />
    </svg>
  ),
  formatTable: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  ),
  cellStyles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <rect x="6" y="6" width="5" height="5" fill="#3b82f6" />
    </svg>
  ),
  insertRow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="8" x2="12" y2="16" />
    </svg>
  ),
  deleteRow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  format: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M7 7h10M7 12h10M7 17h6" />
    </svg>
  ),
  sort: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h7M3 12h5M3 18h3" />
      <path d="M17 6v12M14 15l3 3 3-3" />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  find: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  analyze: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 21H4.6c-.56 0-.84 0-1.05-.11a1 1 0 0 1-.44-.44C3 20.24 3 19.96 3 19.4V3" />
      <path d="m7 14 4-4 4 4 6-6" />
    </svg>
  ),
  comment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  dropdown: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 17v-5M12 17V8M17 17v-8" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  shapes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <circle cx="17.5" cy="6.5" r="4.5" />
      <path d="M12 14l5 8H7l5-8z" />
    </svg>
  ),
  function: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <text x="4" y="18" fontSize="14" fontFamily="serif" fontStyle="italic">fx</text>
    </svg>
  ),
  sum: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 5H6l6 7-6 7h12" />
    </svg>
  ),
  dataValidation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  textToColumns: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M8 6l-4 6 4 6M16 6l4 6-4 6" />
    </svg>
  ),
  spellcheck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M9 12l2 2 4-4" />
      <path d="M17 3l4 4" />
    </svg>
  ),
  protect: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  gridlines: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  freezePanes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="10" y1="3" x2="10" y2="21" strokeWidth="3" />
      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="3" />
    </svg>
  ),
  zoom: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  macro: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  script: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  )
};

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
}

export interface RibbonCommands {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  setFont: (font: string) => void;
  setFontSize: (size: number) => void;
  setFontColor: (color: string) => void;
  setFillColor: (color: string) => void;
  alignLeft: () => void;
  alignCenter: () => void;
  alignRight: () => void;
  mergeCells: () => void;
  insertRow: () => void;
  insertColumn: () => void;
  deleteRow: () => void;
  deleteColumn: () => void;
  insertChart: (type: 'bar' | 'line' | 'pie') => void;
  applyConditionalFormat: () => void;
  sort: (direction: 'asc' | 'desc') => void;
  filter: () => void;
  freezePanes: () => void;
  toggleGridlines: () => void;
}

interface ExcelRibbonProps {
  commands: Partial<RibbonCommands>;
  cellFormat?: CellFormat;
  currentFont?: string;
  currentFontSize?: number;
  currentNumberFormat?: string;
  onRunAutomation?: (prompt: string) => void;
}

interface DropdownProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  width?: number;
}

const Dropdown: React.FC<DropdownProps> = ({ value, options, onChange, width = 120 }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef} style={{ width }}>
      <button
        className="flex items-center justify-between w-full h-6 px-1.5 border border-gray-300 bg-white rounded text-xs hover:border-gray-400"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="flex-1 text-left truncate">{value}</span>
        <span className="w-2.5 h-2.5">{Icons.dropdown}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-72 overflow-y-auto z-50">
          {options.map((option, idx) => (
            <button
              key={idx}
              className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-gray-100 ${option === value ? 'bg-blue-100 text-blue-700' : ''}`}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface RibbonButtonProps {
  icon: React.ReactNode;
  label?: string;
  onClick?: () => void;
  size?: 'small' | 'large';
  active?: boolean;
  disabled?: boolean;
  hasDropdown?: boolean;
  tooltip?: string;
}

const RibbonButton: React.FC<RibbonButtonProps> = ({
  icon,
  label,
  onClick,
  size = 'small',
  active = false,
  disabled = false,
  hasDropdown = false,
  tooltip = ''
}) => {
  const baseClasses = "flex flex-col items-center justify-center border border-transparent rounded cursor-pointer transition-all text-gray-700";
  const hoverClasses = "hover:bg-gray-200 hover:border-gray-300";
  const activeClasses = active ? "bg-blue-100 border-blue-300" : "";
  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : "";

  const sizeClasses = size === 'small'
    ? "w-7 h-7 p-1"
    : "min-w-[50px] h-[66px] px-2 py-1.5 gap-0.5";

  const iconSize = size === 'small' ? "w-4 h-4" : "w-7 h-7";

  return (
    <button
      className={`${baseClasses} ${hoverClasses} ${activeClasses} ${disabledClasses} ${sizeClasses}`}
      onClick={onClick}
      disabled={disabled}
      title={tooltip || label}
    >
      <span className={iconSize}>{icon}</span>
      {size === 'large' && label && (
        <span className="text-[10px] text-center leading-tight max-w-[70px] break-words">{label}</span>
      )}
      {hasDropdown && <span className="w-2 h-2 ml-0.5">{Icons.dropdown}</span>}
    </button>
  );
};

interface SplitButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onDropdownClick?: () => void;
  size?: 'small' | 'large';
}

const SplitButton: React.FC<SplitButtonProps> = ({ icon, label, onClick, onDropdownClick, size = 'large' }) => {
  return (
    <div className={`flex flex-col items-stretch border border-transparent rounded overflow-hidden hover:border-gray-300 ${size === 'large' ? 'min-w-[54px] h-[66px]' : ''}`}>
      <button className="flex-1 flex flex-col items-center justify-center border-none bg-transparent cursor-pointer p-1 gap-0.5 hover:bg-gray-200" onClick={onClick} title={label}>
        <span className="w-6 h-6">{icon}</span>
        {size === 'large' && <span className="text-[10px] text-gray-700 leading-tight">{label}</span>}
      </button>
      <button
        className="flex items-center justify-center h-4 border-none border-t border-gray-200 bg-transparent cursor-pointer hover:bg-gray-300"
        onClick={onDropdownClick || onClick}
      >
        <span className="w-2.5 h-2.5">{Icons.dropdown}</span>
      </button>
    </div>
  );
};

const RibbonGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  return (
    <div className="flex flex-col px-2 py-1 relative">
      <div className="flex items-start gap-1 flex-1">
        {children}
      </div>
      <div className="text-[10px] text-gray-500 text-center pt-1 border-t border-gray-200 mt-1">
        {title}
      </div>
    </div>
  );
};

const RibbonSeparator: React.FC = () => <div className="w-px h-[70px] bg-gray-300 mx-1" />;

const HomeTabContent: React.FC<{
  commands: Partial<RibbonCommands>;
  cellFormat?: CellFormat;
  currentFont: string;
  currentFontSize: string;
  currentNumberFormat: string;
}> = ({ commands, cellFormat, currentFont, currentFontSize, currentNumberFormat }) => {
  const fonts = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'];
  const sizes = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48', '72'];
  const numberFormats = ['General', 'Número', 'Moneda', 'Porcentaje', 'Fecha', 'Texto'];

  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Portapapeles">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.paste} label="Pegar" onClick={() => commands.paste?.()} />
          <div className="flex flex-col gap-0.5">
            <RibbonButton icon={Icons.cut} onClick={() => commands.cut?.()} tooltip="Cortar (Ctrl+X)" />
            <RibbonButton icon={Icons.copy} onClick={() => commands.copy?.()} tooltip="Copiar (Ctrl+C)" />
            <RibbonButton icon={Icons.formatPainter} tooltip="Copiar formato" />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Fuente">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-0.5">
            <Dropdown
              value={currentFont}
              options={fonts}
              onChange={(f) => commands.setFont?.(f)}
              width={130}
            />
            <Dropdown
              value={currentFontSize}
              options={sizes}
              onChange={(s) => commands.setFontSize?.(parseInt(s))}
              width={45}
            />
          </div>
          <div className="flex items-center gap-px">
            <RibbonButton icon={<strong className="text-sm">N</strong>} active={cellFormat?.bold} onClick={() => commands.toggleBold?.()} tooltip="Negrita (Ctrl+B)" />
            <RibbonButton icon={<em className="text-sm">K</em>} active={cellFormat?.italic} onClick={() => commands.toggleItalic?.()} tooltip="Cursiva (Ctrl+I)" />
            <RibbonButton icon={<u className="text-sm">S</u>} active={cellFormat?.underline} onClick={() => commands.toggleUnderline?.()} tooltip="Subrayado (Ctrl+U)" />
            <div className="w-px h-5 bg-gray-300 mx-0.5" />
            <RibbonButton icon={Icons.borders} hasDropdown tooltip="Bordes" />
            <RibbonButton
              icon={
                <div className="flex flex-col items-center">
                  <span className="text-xs">A</span>
                  <div className="w-4 h-1 bg-yellow-400 -mt-0.5" />
                </div>
              }
              hasDropdown
              onClick={() => commands.setFillColor?.('#ffff00')}
              tooltip="Color de relleno"
            />
            <RibbonButton
              icon={
                <div className="flex flex-col items-center">
                  <span className="text-xs">A</span>
                  <div className="w-4 h-1 bg-red-500 -mt-0.5" />
                </div>
              }
              hasDropdown
              onClick={() => commands.setFontColor?.('#ff0000')}
              tooltip="Color de fuente"
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Alineación">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-px">
            <RibbonButton icon={Icons.alignLeft} onClick={() => commands.alignLeft?.()} active={cellFormat?.align === 'left'} tooltip="Alinear izquierda" />
            <RibbonButton icon={Icons.alignCenter} onClick={() => commands.alignCenter?.()} active={cellFormat?.align === 'center'} tooltip="Centrar" />
            <RibbonButton icon={Icons.alignRight} onClick={() => commands.alignRight?.()} active={cellFormat?.align === 'right'} tooltip="Alinear derecha" />
          </div>
          <div className="flex items-center gap-px">
            <RibbonButton icon={Icons.wrapText} hasDropdown tooltip="Ajustar texto" />
            <RibbonButton icon={Icons.merge} hasDropdown onClick={() => commands.mergeCells?.()} tooltip="Combinar celdas" />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Número">
        <div className="flex flex-col gap-0.5">
          <Dropdown value={currentNumberFormat} options={numberFormats} onChange={() => {}} width={100} />
          <div className="flex items-center gap-px">
            <RibbonButton icon={<span className="text-xs font-bold">$</span>} hasDropdown tooltip="Moneda" />
            <RibbonButton icon={<span className="text-xs font-bold">%</span>} tooltip="Porcentaje" />
            <RibbonButton icon={<span className="text-[9px]">,00</span>} tooltip="Estilo millares" />
            <div className="w-px h-5 bg-gray-300 mx-0.5" />
            <RibbonButton icon={<span className="text-[9px]">.0→</span>} tooltip="Aumentar decimales" />
            <RibbonButton icon={<span className="text-[9px]">←.0</span>} tooltip="Disminuir decimales" />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Estilos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.conditionalFormat} label="Formato cond." onClick={() => commands.applyConditionalFormat?.()} />
          <SplitButton icon={Icons.formatTable} label="Formato tabla" onClick={() => {}} />
          <SplitButton icon={Icons.cellStyles} label="Estilos celda" onClick={() => {}} />
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Celdas">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.insertRow} label="Insertar" onClick={() => commands.insertRow?.()} />
          <SplitButton icon={Icons.deleteRow} label="Eliminar" onClick={() => commands.deleteRow?.()} />
          <SplitButton icon={Icons.format} label="Formato" onClick={() => {}} />
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Edición">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.sort} label="Ordenar" onClick={() => commands.sort?.('asc')} />
          <SplitButton icon={Icons.find} label="Buscar" onClick={() => {}} />
        </div>
      </RibbonGroup>
    </div>
  );
};

const InsertTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Tablas">
        <SplitButton icon={Icons.formatTable} label="Tabla" onClick={() => {}} />
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Ilustraciones">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.image} label="Imágenes" onClick={() => {}} />
          <SplitButton icon={Icons.shapes} label="Formas" onClick={() => {}} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Gráficos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.chart} label="Barras" onClick={() => commands.insertChart?.('bar')} />
          <SplitButton icon={Icons.analyze} label="Líneas" onClick={() => commands.insertChart?.('line')} />
          <SplitButton icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v9l6 3" />
            </svg>
          } label="Circular" onClick={() => commands.insertChart?.('pie')} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Vínculos">
        <SplitButton icon={Icons.macro} label="Vínculo" onClick={() => {}} />
      </RibbonGroup>
    </div>
  );
};

const FormulasTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = () => {
  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Biblioteca de funciones">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.function} label="Insertar función" onClick={() => {}} />
          <SplitButton icon={Icons.sum} label="Autosuma" onClick={() => {}} />
          <div className="flex flex-col gap-0.5">
            <RibbonButton icon={<span className="text-[9px]">Σ</span>} size="small" tooltip="Suma" />
            <RibbonButton icon={<span className="text-[9px]">fx</span>} size="small" tooltip="Función" />
          </div>
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Nombres definidos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.format} label="Administrar nombres" onClick={() => {}} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Auditoría de fórmulas">
        <div className="flex items-start gap-0.5">
          <RibbonButton icon={Icons.analyze} size="large" label="Rastrear" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const DataTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Ordenar y filtrar">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.sort} label="Ordenar" onClick={() => commands.sort?.('asc')} />
          <SplitButton icon={Icons.filter} label="Filtro" onClick={() => commands.filter?.()} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Herramientas de datos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.textToColumns} label="Texto en columnas" onClick={() => {}} />
          <SplitButton icon={Icons.dataValidation} label="Validación de datos" onClick={() => {}} />
        </div>
      </RibbonGroup>
    </div>
  );
};

const ReviewTabContent: React.FC = () => {
  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Revisión">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.spellcheck} label="Ortografía" onClick={() => {}} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Comentarios">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.comment} label="Nuevo comentario" onClick={() => {}} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Proteger">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.protect} label="Proteger hoja" onClick={() => {}} />
        </div>
      </RibbonGroup>
    </div>
  );
};

const ViewTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Mostrar">
        <div className="flex flex-col gap-0.5">
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" defaultChecked className="w-3 h-3" onChange={() => commands.toggleGridlines?.()} />
            Líneas de cuadrícula
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" defaultChecked className="w-3 h-3" />
            Encabezados
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" className="w-3 h-3" />
            Barra de fórmulas
          </label>
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Ventana">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.freezePanes} label="Inmovilizar paneles" onClick={() => commands.freezePanes?.()} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Zoom">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.zoom} label="Zoom" onClick={() => {}} />
          <RibbonButton icon={<span className="text-xs">100%</span>} size="large" label="100%" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const AutomateTabContent: React.FC<{ onRunAutomation?: (prompt: string) => void }> = ({ onRunAutomation }) => {
  const [prompt, setPrompt] = useState('');

  return (
    <div className="flex items-start gap-0.5 px-2 py-1 min-h-[80px] bg-gray-50">
      <RibbonGroup title="Automatización">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.macro} label="Macros" onClick={() => {}} />
          <SplitButton icon={Icons.script} label="Scripts" onClick={() => {}} />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="IA">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe qué quieres crear..."
            className="w-64 h-8 px-2 text-xs border border-gray-300 rounded focus:outline-none focus:border-green-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && prompt.trim() && onRunAutomation) {
                onRunAutomation(prompt.trim());
                setPrompt('');
              }
            }}
          />
          <button
            onClick={() => {
              if (prompt.trim() && onRunAutomation) {
                onRunAutomation(prompt.trim());
                setPrompt('');
              }
            }}
            className="px-3 h-8 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
          >
            Ejecutar IA
          </button>
        </div>
      </RibbonGroup>
    </div>
  );
};

const PlaceholderTabContent: React.FC<{ tabName: string }> = ({ tabName }) => {
  return (
    <div className="flex items-center justify-center px-2 py-1 min-h-[80px] bg-gray-50 text-gray-400 text-sm">
      Contenido de {tabName} - En desarrollo
    </div>
  );
};

export const ExcelRibbon: React.FC<ExcelRibbonProps> = ({
  commands,
  cellFormat,
  currentFont = 'Calibri',
  currentFontSize = 11,
  currentNumberFormat = 'General',
  onRunAutomation
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('home');

  const renderTabContent = useCallback(() => {
    switch (activeTab) {
      case 'home':
        return (
          <HomeTabContent
            commands={commands}
            cellFormat={cellFormat}
            currentFont={currentFont}
            currentFontSize={String(currentFontSize)}
            currentNumberFormat={currentNumberFormat}
          />
        );
      case 'insert':
        return <InsertTabContent commands={commands} />;
      case 'formulas':
        return <FormulasTabContent commands={commands} />;
      case 'data':
        return <DataTabContent commands={commands} />;
      case 'review':
        return <ReviewTabContent />;
      case 'view':
        return <ViewTabContent commands={commands} />;
      case 'automate':
        return <AutomateTabContent onRunAutomation={onRunAutomation} />;
      default:
        return <PlaceholderTabContent tabName={RIBBON_TABS.find(t => t.id === activeTab)?.label || activeTab} />;
    }
  }, [activeTab, commands, cellFormat, currentFont, currentFontSize, currentNumberFormat, onRunAutomation]);

  return (
    <div className="flex flex-col border-b border-gray-200 bg-white select-none" data-testid="excel-ribbon">
      <div className="flex justify-between items-center px-2 border-b border-gray-200">
        <div className="flex">
          {RIBBON_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`px-3.5 py-2 border-none bg-transparent text-sm cursor-pointer border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'text-green-600 border-green-600 font-medium'
                  : 'text-gray-600 border-transparent hover:bg-gray-100'
              }`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`ribbon-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 bg-white rounded text-xs text-gray-600 cursor-pointer hover:bg-gray-100">
            <span className="w-4 h-4">{Icons.comment}</span>
            Comentarios
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-green-600 bg-gradient-to-br from-green-600 to-green-700 text-white rounded text-xs cursor-pointer hover:from-green-700 hover:to-green-800">
            <span className="w-4 h-4">{Icons.share}</span>
            Compartir
          </button>
        </div>
      </div>

      {renderTabContent()}
    </div>
  );
};

export default ExcelRibbon;
