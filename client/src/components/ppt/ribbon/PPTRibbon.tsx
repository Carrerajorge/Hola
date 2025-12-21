import React from 'react';
import { useDeckStore, selectSelectedElement, RibbonTab } from '../store/deckStore';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { 
  Type, 
  Square, 
  Circle, 
  Image, 
  Bold,
  Italic,
  Underline,
  Sparkles
} from 'lucide-react';

const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 56, 72];

export function PPTRibbon() {
  const activeTab = useDeckStore((s) => s.activeTab);
  const setActiveTab = useDeckStore((s) => s.setActiveTab);
  const editorMode = useDeckStore((s) => s.editorMode);
  const setEditorMode = useDeckStore((s) => s.setEditorMode);
  const addTextElement = useDeckStore((s) => s.addTextElement);
  const addShapeElement = useDeckStore((s) => s.addShapeElement);
  const addImageElement = useDeckStore((s) => s.addImageElement);
  const applyTextStyleToDefault = useDeckStore((s) => s.applyTextStyleToDefault);
  
  const selectedElement = useDeckStore(selectSelectedElement);
  const textStyle = selectedElement?.type === 'text' ? selectedElement.defaultTextStyle : null;

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const src = ev.target?.result as string;
          const img = new window.Image();
          img.onload = () => {
            addImageElement(src, img.naturalWidth, img.naturalHeight);
          };
          img.src = src;
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  return (
    <div className="border-b bg-muted/30">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as RibbonTab)} className="w-full">
        <TabsList className="h-10 w-full justify-start rounded-none border-b bg-transparent px-2">
          <TabsTrigger value="Home" className="data-[state=active]:bg-background">Inicio</TabsTrigger>
          <TabsTrigger value="Insert" className="data-[state=active]:bg-background">Insertar</TabsTrigger>
          <TabsTrigger value="Layout" className="data-[state=active]:bg-background">Diseño</TabsTrigger>
          <TabsTrigger value="AI" className="data-[state=active]:bg-background">
            <Sparkles className="h-4 w-4 mr-1" />
            IA
          </TabsTrigger>
        </TabsList>

        <div className="min-h-[72px] px-4 py-2 flex items-center gap-4">
          {activeTab === 'Home' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Fuente</span>
                <div className="flex items-center gap-1">
                  <Select
                    value={textStyle?.fontFamily ?? 'Inter'}
                    onValueChange={(v) => selectedElement && applyTextStyleToDefault(selectedElement.id, { fontFamily: v })}
                    disabled={!textStyle}
                  >
                    <SelectTrigger className="h-8 w-32 text-sm" data-testid="ribbon-font-family">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_FAMILIES.map((font) => (
                        <SelectItem key={font.value} value={font.value}>{font.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(textStyle?.fontSize ?? 24)}
                    onValueChange={(v) => selectedElement && applyTextStyleToDefault(selectedElement.id, { fontSize: Number(v) })}
                    disabled={!textStyle}
                  >
                    <SelectTrigger className="h-8 w-16 text-sm" data-testid="ribbon-font-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_SIZES.map((size) => (
                        <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator orientation="vertical" className="h-12" />

              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Formato</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant={textStyle?.bold ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => selectedElement && applyTextStyleToDefault(selectedElement.id, { bold: !textStyle?.bold })}
                    disabled={!textStyle}
                    data-testid="ribbon-bold"
                  >
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={textStyle?.italic ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => selectedElement && applyTextStyleToDefault(selectedElement.id, { italic: !textStyle?.italic })}
                    disabled={!textStyle}
                    data-testid="ribbon-italic"
                  >
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={textStyle?.underline ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => selectedElement && applyTextStyleToDefault(selectedElement.id, { underline: !textStyle?.underline })}
                    disabled={!textStyle}
                    data-testid="ribbon-underline"
                  >
                    <Underline className="h-4 w-4" />
                  </Button>
                  <div className="relative">
                    <Input
                      type="color"
                      value={textStyle?.color ?? '#111111'}
                      onChange={(e) => selectedElement && applyTextStyleToDefault(selectedElement.id, { color: e.target.value })}
                      className="w-8 h-8 p-1"
                      disabled={!textStyle}
                      data-testid="ribbon-text-color"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'Insert' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Elementos</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addTextElement}
                    className="gap-1"
                    data-testid="btn-insert-text"
                  >
                    <Type className="h-4 w-4" />
                    Texto
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addShapeElement('rect')}
                    className="gap-1"
                    data-testid="btn-insert-rect"
                  >
                    <Square className="h-4 w-4" />
                    Rectángulo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addShapeElement('ellipse')}
                    className="gap-1"
                    data-testid="btn-insert-ellipse"
                  >
                    <Circle className="h-4 w-4" />
                    Elipse
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleImageUpload}
                    className="gap-1"
                    data-testid="btn-insert-image"
                  >
                    <Image className="h-4 w-4" />
                    Imagen
                  </Button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'Layout' && (
            <div className="text-sm text-muted-foreground">
              Opciones de diseño disponibles próximamente
            </div>
          )}

          {activeTab === 'AI' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Modo IA</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant={editorMode === 'ai' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEditorMode(editorMode === 'ai' ? 'manual' : 'ai')}
                    className="gap-1"
                    data-testid="btn-toggle-ai-mode"
                  >
                    <Sparkles className="h-4 w-4" />
                    {editorMode === 'ai' ? 'Modo IA Activo' : 'Activar Modo IA'}
                  </Button>
                  {editorMode === 'ai' && (
                    <span className="text-xs text-muted-foreground">
                      El contenido de IA se escribirá directamente en las diapositivas
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
