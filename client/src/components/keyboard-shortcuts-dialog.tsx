import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  { keys: ["Ctrl", "N"], description: "Nuevo chat" },
  { keys: ["Ctrl", "K"], description: "Búsqueda rápida" },
  { keys: ["Ctrl", ","], description: "Configuración" },
  { keys: ["Ctrl", "E"], description: "Exportar chat actual" },
  { keys: ["Ctrl", "T"], description: "Plantillas de prompts" },
  { keys: ["Ctrl", "Shift", "F"], description: "Favoritos" },
  { keys: ["Ctrl", "/"], description: "Mostrar atajos" },
  { keys: ["Escape"], description: "Cerrar diálogo" },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Atajos de teclado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 py-2">
          {shortcuts.map((shortcut, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between py-2 px-1 rounded hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm text-muted-foreground">
                {shortcut.description}
              </span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, keyIdx) => (
                  <kbd
                    key={keyIdx}
                    className="px-2 py-1 text-xs font-medium bg-muted border border-border rounded shadow-sm"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
