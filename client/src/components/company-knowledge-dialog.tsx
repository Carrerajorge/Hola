import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Building2, 
  FileText, 
  Loader2,
  ChevronRight,
  ToggleLeft,
  ToggleRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CompanyKnowledge {
  id: string;
  userId: string;
  title: string;
  content: string;
  category: string;
  isActive: string;
  createdAt: string;
  updatedAt: string;
}

interface CompanyKnowledgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const categories = [
  { value: "general", label: "General" },
  { value: "policies", label: "Políticas" },
  { value: "procedures", label: "Procedimientos" },
  { value: "products", label: "Productos/Servicios" },
  { value: "team", label: "Equipo/Organización" },
  { value: "clients", label: "Clientes" },
  { value: "other", label: "Otros" },
];

export function CompanyKnowledgeDialog({ open, onOpenChange }: CompanyKnowledgeDialogProps) {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isEditing, setIsEditing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<CompanyKnowledge | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "general",
  });

  const { data: knowledgeEntries = [], isLoading } = useQuery<CompanyKnowledge[]>({
    queryKey: ["company-knowledge", userId],
    queryFn: async () => {
      if (!userId) return [];
      const res = await fetch(`/api/users/${userId}/company-knowledge`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch company knowledge");
      return res.json();
    },
    enabled: !!userId && open,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; category: string }) => {
      const res = await fetch(`/api/users/${userId}/company-knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create knowledge entry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-knowledge", userId] });
      resetForm();
      toast({ title: "Conocimiento creado", description: "La entrada se ha guardado correctamente." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear la entrada.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; title?: string; content?: string; category?: string; isActive?: boolean }) => {
      const res = await fetch(`/api/users/${userId}/company-knowledge/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update knowledge entry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-knowledge", userId] });
      resetForm();
      toast({ title: "Conocimiento actualizado", description: "Los cambios se han guardado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar la entrada.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${userId}/company-knowledge/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete knowledge entry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-knowledge", userId] });
      setDeleteConfirmId(null);
      toast({ title: "Conocimiento eliminado", description: "La entrada se ha eliminado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar la entrada.", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ title: "", content: "", category: "general" });
    setSelectedEntry(null);
    setIsEditing(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.content.trim()) {
      toast({ title: "Error", description: "Título y contenido son requeridos.", variant: "destructive" });
      return;
    }

    if (selectedEntry) {
      updateMutation.mutate({ id: selectedEntry.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (entry: CompanyKnowledge) => {
    setSelectedEntry(entry);
    setFormData({
      title: entry.title,
      content: entry.content,
      category: entry.category,
    });
    setIsEditing(true);
  };

  const handleToggleActive = (entry: CompanyKnowledge) => {
    updateMutation.mutate({ 
      id: entry.id, 
      isActive: entry.isActive !== "true" 
    });
  };

  const getCategoryLabel = (value: string) => {
    return categories.find(c => c.value === value)?.label || value;
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh]" data-testid="company-knowledge-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="dialog-title-company-knowledge">
              <Building2 className="h-5 w-5 text-purple-500" />
              Conocimientos de la empresa
            </DialogTitle>
            <DialogDescription>
              Agrega información sobre tu empresa que la IA usará como contexto para respuestas más precisas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {isEditing ? "Editar entrada" : "Nueva entrada"}
                </h3>
                {isEditing && (
                  <Button variant="ghost" size="sm" onClick={resetForm} data-testid="button-cancel-edit">
                    Cancelar
                  </Button>
                )}
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Título</Label>
                  <Input
                    id="title"
                    placeholder="Ej: Política de devoluciones"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    data-testid="input-knowledge-title"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Categoría</Label>
                  <Select 
                    value={formData.category} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                  >
                    <SelectTrigger id="category" data-testid="select-knowledge-category">
                      <SelectValue placeholder="Selecciona una categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content">Contenido</Label>
                  <Textarea
                    id="content"
                    placeholder="Describe la información que quieres que la IA conozca..."
                    value={formData.content}
                    onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                    rows={6}
                    data-testid="textarea-knowledge-content"
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-knowledge"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {selectedEntry ? "Actualizar" : "Guardar"}
                </Button>
              </form>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium">Entradas guardadas ({knowledgeEntries.length})</h3>
              
              <ScrollArea className="h-[380px] border rounded-lg">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : knowledgeEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-8 text-center px-4">
                    <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Aún no hay conocimientos guardados.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Agrega información sobre tu empresa para que la IA pueda usarla.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 p-2">
                    {knowledgeEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "group p-3 rounded-lg border transition-colors hover:bg-accent",
                          entry.isActive !== "true" && "opacity-50"
                        )}
                        data-testid={`knowledge-entry-${entry.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-sm truncate">{entry.title}</h4>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {getCategoryLabel(entry.category)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {entry.content}
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleToggleActive(entry)}
                              title={entry.isActive === "true" ? "Desactivar" : "Activar"}
                              data-testid={`button-toggle-${entry.id}`}
                            >
                              {entry.isActive === "true" ? (
                                <ToggleRight className="h-4 w-4 text-green-500" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleEdit(entry)}
                              data-testid={`button-edit-${entry.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteConfirmId(entry.id)}
                              data-testid={`button-delete-${entry.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent data-testid="delete-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El conocimiento se eliminará permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
