import React, { useCallback, useRef } from 'react';
import { useDeckStore, selectDeck, selectCanUndo, selectCanRedo } from './store/deckStore';
import { CanvasStage } from './canvas/CanvasStage';
import { SlidesPanel, LayersPanel, PropertiesPanel } from './panels';
import { PPTRibbon } from './ribbon/PPTRibbon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  X, 
  Download, 
  Undo, 
  Redo,
  Layers,
  Settings2
} from 'lucide-react';
import { exportDeckToPptx, downloadBlob } from '@/lib/pptExport';

interface PPTEditorShellProps {
  onClose: () => void;
  onInsertContent?: (insertFn: (content: string) => void) => void;
}

export function PPTEditorShell({ onClose, onInsertContent }: PPTEditorShellProps) {
  const deck = useDeckStore(selectDeck);
  const canUndoValue = useDeckStore(selectCanUndo);
  const canRedoValue = useDeckStore(selectCanRedo);
  const setTitle = useDeckStore((s) => s.setTitle);
  const undo = useDeckStore((s) => s.undo);
  const redo = useDeckStore((s) => s.redo);

  const titleRef = useRef<HTMLInputElement>(null);

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
    <div className="h-full flex flex-col bg-background" data-testid="ppt-editor-shell">
      <header className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-4">
          <Input
            ref={titleRef}
            value={deck.title}
            onChange={handleTitleChange}
            className="w-64 h-8 font-semibold border-transparent hover:border-input focus:border-input"
            placeholder="Título de la presentación"
            data-testid="input-deck-title"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={undo}
            disabled={!canUndoValue}
            title="Deshacer (Ctrl+Z)"
            data-testid="btn-undo"
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={redo}
            disabled={!canRedoValue}
            title="Rehacer (Ctrl+Y)"
            data-testid="btn-redo"
          >
            <Redo className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-border mx-2" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-1"
            data-testid="btn-export-pptx"
          >
            <Download className="h-4 w-4" />
            Exportar PPTX
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            title="Cerrar"
            data-testid="btn-close-ppt"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <PPTRibbon />

      <div className="flex-1 flex min-h-0">
        <div className="w-[190px] border-r">
          <SlidesPanel />
        </div>

        <div className="flex-1 min-w-0">
          <CanvasStage />
        </div>

        <div className="w-[280px] border-l">
          <Tabs defaultValue="properties" className="h-full">
            <TabsList className="w-full justify-start rounded-none border-b px-2 h-10">
              <TabsTrigger value="properties" className="gap-1 text-xs">
                <Settings2 className="h-3 w-3" />
                Propiedades
              </TabsTrigger>
              <TabsTrigger value="layers" className="gap-1 text-xs">
                <Layers className="h-3 w-3" />
                Capas
              </TabsTrigger>
            </TabsList>
            <TabsContent value="properties" className="h-[calc(100%-40px)] m-0">
              <PropertiesPanel />
            </TabsContent>
            <TabsContent value="layers" className="h-[calc(100%-40px)] m-0">
              <LayersPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default PPTEditorShell;
