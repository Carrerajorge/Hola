import React, { useCallback, useRef, useState } from 'react';
import { useDeckStore, selectDeck, selectCanUndo, selectCanRedo } from './store/deckStore';
import { CanvasStage } from './canvas/CanvasStage';
import { SlidesPanel } from './panels';
import { PPTRibbon } from './ribbon/PPTRibbon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { 
  X, 
  Download, 
  MessageSquare,
  StickyNote,
  Monitor,
  Columns,
  Square,
  ZoomIn,
  ZoomOut,
  Check,
  ChevronDown
} from 'lucide-react';
import { exportDeckToPptx, downloadBlob } from '@/lib/pptExport';
import { cn } from '@/lib/utils';

interface PPTEditorShellProps {
  onClose: () => void;
  onInsertContent?: (insertFn: (content: string) => void) => void;
}

export function PPTEditorShell({ onClose, onInsertContent }: PPTEditorShellProps) {
  const deck = useDeckStore(selectDeck);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const zoom = useDeckStore((s) => s.zoom);
  const setZoom = useDeckStore((s) => s.setZoom);
  const setTitle = useDeckStore((s) => s.setTitle);

  const [showNotes, setShowNotes] = useState(true);

  const titleRef = useRef<HTMLInputElement>(null);

  const activeSlideIndex = deck.slides.findIndex(s => s.id === activeSlideId) + 1;
  const totalSlides = deck.slides.length;

  const handleExport = useCallback(async () => {
    try {
      const currentDeck = selectDeck(useDeckStore.getState());
      const blob = await exportDeckToPptx(currentDeck);
      downloadBlob(blob, `${currentDeck.title || 'presentacion'}.pptx`);
    } catch (error) {
      console.error('Export failed:', error);
    }
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  return (
    <div className="h-full flex flex-col bg-white" data-testid="ppt-editor-shell">
      <PPTRibbon />

      <div className="flex-1 flex min-h-0">
        <div className="w-[72px] border-r border-gray-200 bg-[#f6f7fb]">
          <SlidesPanel />
        </div>

        <div className="flex-1 min-w-0 flex flex-col bg-[#f6f7fb]">
          <div className="flex-1 relative">
            <CanvasStage />
          </div>

          {showNotes && (
            <div className="h-[40px] border-t border-gray-300 bg-white flex items-center px-4">
              <input
                type="text"
                placeholder="Haz clic para agregar notas"
                className="flex-1 text-sm text-gray-400 bg-transparent border-none outline-none"
              />
            </div>
          )}
        </div>
      </div>

      <footer className="h-[24px] flex items-center justify-between px-2 bg-[#f3f3f3] border-t border-gray-300 text-[11px] text-gray-600">
        <div className="flex items-center gap-3">
          <span>Diapositiva {activeSlideIndex} de {totalSlides}</span>
          <div className="w-px h-3 bg-gray-300" />
          <button className="hover:bg-gray-200 px-1 rounded flex items-center gap-1">
            Español (Estados Unidos)
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
          <div className="w-px h-3 bg-gray-300" />
          <div className="flex items-center gap-1">
            <Check className="h-3 w-3 text-green-600" />
            <span>Accesibilidad: todo correcto</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-200",
              showNotes && "bg-gray-200"
            )}
            onClick={() => setShowNotes(!showNotes)}
          >
            <StickyNote className="h-3 w-3" />
            <span>Notas</span>
          </button>
          <button className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-200">
            <MessageSquare className="h-3 w-3" />
            <span>Comentarios</span>
          </button>

          <div className="w-px h-3 bg-gray-300 mx-1" />

          <div className="flex items-center gap-0.5 bg-gray-200 rounded p-0.5">
            <button className="p-0.5 rounded hover:bg-gray-300">
              <Monitor className="h-3 w-3" />
            </button>
            <button className="p-0.5 rounded hover:bg-gray-300">
              <Columns className="h-3 w-3" />
            </button>
            <button className="p-0.5 rounded bg-white shadow-sm">
              <Square className="h-3 w-3" />
            </button>
          </div>

          <div className="w-px h-3 bg-gray-300 mx-1" />

          <div className="flex items-center gap-1">
            <button 
              className="p-0.5 rounded hover:bg-gray-200"
              onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <div className="w-[80px]">
              <Slider
                value={[zoom * 100]}
                min={25}
                max={200}
                step={5}
                onValueChange={([val]) => setZoom(val / 100)}
                className="h-1"
              />
            </div>
            <button 
              className="p-0.5 rounded hover:bg-gray-200"
              onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] w-10 text-center">{Math.round(zoom * 100)}%</span>
          </div>

          <button 
            className="ml-2 p-0.5 rounded hover:bg-gray-200"
            onClick={handleExport}
            title="Exportar PPTX"
          >
            <Download className="h-3.5 w-3.5" />
          </button>

          <button 
            className="p-0.5 rounded hover:bg-gray-200"
            onClick={onClose}
            title="Cerrar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>
    </div>
  );
}

export default PPTEditorShell;
