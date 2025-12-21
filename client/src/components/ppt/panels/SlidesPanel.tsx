import React from 'react';
import { useDeckStore, selectDeck } from '../store/deckStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;

export function SlidesPanel() {
  const deck = useDeckStore(selectDeck);
  const activeSlideId = useDeckStore((s) => s.activeSlideId);
  const setActiveSlide = useDeckStore((s) => s.setActiveSlide);
  const addSlide = useDeckStore((s) => s.addSlide);
  const duplicateSlide = useDeckStore((s) => s.duplicateSlide);
  const deleteSlide = useDeckStore((s) => s.deleteSlide);

  return (
    <div className="h-full flex flex-col bg-background border-r">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="font-semibold text-sm">Diapositivas</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={addSlide}
          data-testid="btn-add-slide"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {deck.slides.map((slide, index) => (
            <div
              key={slide.id}
              className={cn(
                "group relative rounded-lg cursor-pointer transition-all",
                "border-2 hover:border-primary/50",
                activeSlideId === slide.id ? "border-primary ring-2 ring-primary/20" : "border-transparent"
              )}
              onClick={() => setActiveSlide(slide.id)}
              data-testid={`slide-thumbnail-${index}`}
            >
              <div
                className="rounded-md overflow-hidden"
                style={{
                  width: THUMB_WIDTH,
                  height: THUMB_HEIGHT,
                  backgroundColor: slide.background.color
                }}
              >
                <div className="relative w-full h-full">
                  <svg
                    viewBox="0 0 1280 720"
                    width={THUMB_WIDTH}
                    height={THUMB_HEIGHT}
                    className="w-full h-full"
                  >
                    <rect
                      width="1280"
                      height="720"
                      fill={slide.background.color}
                    />
                    {slide.elements.map((el) => {
                      if (el.type === 'text') {
                        const text = el.delta.ops.map(op => op.insert).join('').slice(0, 50);
                        return (
                          <text
                            key={el.id}
                            x={el.x}
                            y={el.y + (el.defaultTextStyle?.fontSize || 24)}
                            fontSize={el.defaultTextStyle?.fontSize || 24}
                            fill={el.defaultTextStyle?.color || '#000'}
                            fontFamily={el.defaultTextStyle?.fontFamily || 'sans-serif'}
                          >
                            {text.slice(0, 30)}
                          </text>
                        );
                      }
                      if (el.type === 'shape') {
                        if (el.shapeType === 'ellipse') {
                          return (
                            <ellipse
                              key={el.id}
                              cx={el.x + el.w / 2}
                              cy={el.y + el.h / 2}
                              rx={el.w / 2}
                              ry={el.h / 2}
                              fill={el.fill}
                              stroke={el.stroke}
                              strokeWidth={el.strokeWidth}
                            />
                          );
                        }
                        return (
                          <rect
                            key={el.id}
                            x={el.x}
                            y={el.y}
                            width={el.w}
                            height={el.h}
                            fill={el.fill}
                            stroke={el.stroke}
                            strokeWidth={el.strokeWidth}
                            rx={el.radius || 0}
                          />
                        );
                      }
                      if (el.type === 'image' || el.type === 'chart') {
                        return (
                          <rect
                            key={el.id}
                            x={el.x}
                            y={el.y}
                            width={el.w}
                            height={el.h}
                            fill="#e5e7eb"
                            stroke="#d1d5db"
                          />
                        );
                      }
                      return null;
                    })}
                  </svg>
                </div>
              </div>
              
              <div className="absolute bottom-1 left-1 bg-background/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-xs">
                {index + 1}
              </div>

              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateSlide(slide.id);
                  }}
                  data-testid={`btn-duplicate-slide-${index}`}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                {deck.slides.length > 1 && (
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSlide(slide.id);
                    }}
                    data-testid={`btn-delete-slide-${index}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
