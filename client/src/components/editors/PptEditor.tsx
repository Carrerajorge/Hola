import { useEffect, useMemo, useState } from 'react';
import { Plus, Presentation } from 'lucide-react';

interface SlideData {
    title: string;
    content: string;
}

interface PptEditorProps {
    slides?: SlideData[];
    onChange?: (slides: SlideData[]) => void;
}

export default function PptEditor({ slides, onChange }: PptEditorProps) {
    const defaultSlides = useMemo(() => slides?.length
        ? slides
        : [{ title: 'Diapositiva 1', content: '' }]
    , [slides]);

    const [deck, setDeck] = useState<SlideData[]>(defaultSlides);
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        setDeck(defaultSlides);
        setActiveIndex(0);
    }, [defaultSlides]);

    const updateSlide = (updates: Partial<SlideData>) => {
        setDeck((prev) => {
            const next = prev.map((slide, index) =>
                index === activeIndex ? { ...slide, ...updates } : slide
            );
            onChange?.(next);
            return next;
        });
    };

    const addSlide = () => {
        setDeck((prev) => {
            const next = [...prev, { title: `Diapositiva ${prev.length + 1}`, content: '' }];
            onChange?.(next);
            return next;
        });
        setActiveIndex((prev) => prev + 1);
    };

    const activeSlide = deck[activeIndex] ?? { title: '', content: '' };

    return (
        <div className="w-full h-[28rem] border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/50">
                <div className="flex items-center gap-2">
                    <Presentation className="w-4 h-4" />
                    <span className="text-sm font-medium">Editor de Presentación</span>
                </div>
                <button
                    type="button"
                    onClick={addSlide}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                    <Plus className="h-3 w-3" />
                    Nueva diapositiva
                </button>
            </div>
            <div className="flex h-[24rem]">
                <div className="w-56 border-r bg-muted/30 p-2 space-y-2 overflow-auto">
                    {deck.map((slide, idx) => (
                        <button
                            key={`${slide.title}-${idx}`}
                            type="button"
                            onClick={() => setActiveIndex(idx)}
                            className={`w-full text-left p-2 border rounded text-xs transition ${idx === activeIndex ? 'bg-muted' : 'bg-card hover:bg-muted/70'}`}
                        >
                            <p className="font-semibold truncate">{slide.title}</p>
                            <p className="text-muted-foreground line-clamp-2">{slide.content || 'Sin contenido'}</p>
                        </button>
                    ))}
                </div>
                <div className="flex-1 p-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-muted-foreground">Título</label>
                        <input
                            value={activeSlide.title}
                            onChange={(event) => updateSlide({ title: event.target.value })}
                            className="border rounded-md px-3 py-2 text-sm bg-background"
                        />
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                        <label className="text-xs font-medium text-muted-foreground">Contenido</label>
                        <textarea
                            value={activeSlide.content}
                            onChange={(event) => updateSlide({ content: event.target.value })}
                            className="flex-1 border rounded-md px-3 py-2 text-sm bg-background resize-none"
                            placeholder="Escribe el contenido principal de la diapositiva..."
                        />
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="w-full max-w-lg aspect-video bg-white border shadow-lg rounded flex flex-col p-6">
                            <h3 className="text-lg font-semibold text-slate-900">{activeSlide.title || 'Título'}</h3>
                            <p className="mt-4 text-sm text-slate-600 whitespace-pre-wrap">
                                {activeSlide.content || 'Contenido de la diapositiva'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
