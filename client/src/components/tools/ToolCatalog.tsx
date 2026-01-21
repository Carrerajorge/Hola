/**
 * ToolCatalog - Placeholder Component
 * TODO: Implement full tool catalog functionality
 */
import { Wrench, X } from 'lucide-react';

interface ToolCatalogProps {
    isOpen?: boolean;
    onClose?: () => void;
}

export default function ToolCatalog({ isOpen, onClose }: ToolCatalogProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-4xl max-h-[90vh] bg-card rounded-lg shadow-lg border overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-2">
                        <Wrench className="w-5 h-5" />
                        <h2 className="text-lg font-semibold">Catálogo de Herramientas</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 text-center text-muted-foreground">
                    <Wrench className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>Catálogo de herramientas en desarrollo...</p>
                </div>
            </div>
        </div>
    );
}
