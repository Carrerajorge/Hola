import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  ChevronLeft,
  Plus,
  X,
  MoreHorizontal,
  Link as LinkIcon,
  History,
  Copy,
  Trash2,
  Mic,
  Send,
  Upload,
  FileText,
  HelpCircle,
  RotateCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Gpt } from "./gpt-explorer";
import type { GptKnowledge, GptAction } from "@shared/schema";

interface GptBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingGpt?: Gpt | null;
  onSave?: (gpt: Gpt) => void;
}

interface ActionFormData {
  name: string;
  description: string;
  httpMethod: string;
  endpoint: string;
  authType: string;
}

export function GptBuilder({ open, onOpenChange, editingGpt, onSave }: GptBuilderProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"crear" | "configurar">("configurar");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<GptKnowledge[]>([]);
  const [actions, setActions] = useState<GptAction[]>([]);
  const [previewMessage, setPreviewMessage] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [showActionEditor, setShowActionEditor] = useState(false);
  const [editingAction, setEditingAction] = useState<GptAction | null>(null);
  const [actionForm, setActionForm] = useState<ActionFormData>({
    name: "",
    description: "",
    httpMethod: "GET",
    endpoint: "",
    authType: "none"
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    systemPrompt: "",
    welcomeMessage: "",
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
    visibility: "private" as "private" | "public" | "unlisted",
    conversationStarters: [""],
    recommendedModel: "",
    capabilities: {
      webBrowsing: true,
      canvas: true,
      imageGeneration: true,
      codeInterpreter: false
    }
  });

  useEffect(() => {
    if (editingGpt) {
      setFormData({
        name: editingGpt.name,
        slug: editingGpt.slug,
        description: editingGpt.description || "",
        systemPrompt: editingGpt.systemPrompt,
        welcomeMessage: editingGpt.welcomeMessage || "",
        temperature: parseFloat(editingGpt.temperature || "0.7"),
        topP: parseFloat(editingGpt.topP || "1"),
        maxTokens: editingGpt.maxTokens || 4096,
        visibility: (editingGpt.visibility as "private" | "public" | "unlisted") || "private",
        conversationStarters: Array.isArray(editingGpt.conversationStarters) && editingGpt.conversationStarters.length > 0
          ? editingGpt.conversationStarters
          : [""],
        recommendedModel: "",
        capabilities: editingGpt.capabilities || {
          webBrowsing: true,
          canvas: true,
          imageGeneration: true,
          codeInterpreter: false
        }
      });
      loadKnowledgeAndActions(editingGpt.id);
      setAvatarPreview(editingGpt.avatar || null);
    } else {
      setFormData({
        name: "",
        slug: "",
        description: "",
        systemPrompt: "",
        welcomeMessage: "",
        temperature: 0.7,
        topP: 1,
        maxTokens: 4096,
        visibility: "private",
        conversationStarters: [""],
        recommendedModel: "",
        capabilities: {
          webBrowsing: true,
          canvas: true,
          imageGeneration: true,
          codeInterpreter: false
        }
      });
      setKnowledgeFiles([]);
      setActions([]);
      setAvatarPreview(null);
    }
    setHasChanges(false);
    setPreviewMessage("");
  }, [editingGpt, open]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
        setHasChanges(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const loadKnowledgeAndActions = async (gptId: string) => {
    try {
      const [knowledgeRes, actionsRes] = await Promise.all([
        fetch(`/api/gpts/${gptId}/knowledge`),
        fetch(`/api/gpts/${gptId}/actions`)
      ]);
      if (knowledgeRes.ok) setKnowledgeFiles(await knowledgeRes.json());
      if (actionsRes.ok) setActions(await actionsRes.json());
    } catch (error) {
      console.error("Error loading knowledge/actions:", error);
    }
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  };

  const handleFormChange = (updates: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "El nombre es requerido",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    try {
      const slug = formData.slug || generateSlug(formData.name);
      const payload = {
        name: formData.name,
        slug,
        description: formData.description,
        avatar: avatarPreview,
        systemPrompt: formData.systemPrompt,
        welcomeMessage: formData.welcomeMessage,
        temperature: formData.temperature.toString(),
        topP: formData.topP.toString(),
        maxTokens: formData.maxTokens,
        visibility: formData.visibility,
        conversationStarters: formData.conversationStarters.filter(s => s.trim()),
        capabilities: formData.capabilities,
        recommendedModel: formData.recommendedModel || null
      };

      const url = editingGpt ? `/api/gpts/${editingGpt.id}` : "/api/gpts";
      const method = editingGpt ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const savedGpt = await response.json();
        toast({ title: editingGpt ? "GPT actualizado" : "GPT creado" });
        setHasChanges(false);
        onSave?.(savedGpt);
      } else {
        throw new Error("Error al guardar");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar el GPT",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    if (!editingGpt) {
      toast({
        title: "Guarda primero",
        description: "Guarda el GPT antes de subir archivos",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const response = await fetch(`/api/gpts/${editingGpt.id}/knowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type || "application/octet-stream",
            fileSize: file.size,
            storageUrl: `pending://${file.name}`,
            embeddingStatus: "pending"
          })
        });
        if (response.ok) {
          const newKnowledge = await response.json();
          setKnowledgeFiles(prev => [newKnowledge, ...prev]);
        }
      } catch (error) {
        console.error("Error uploading file:", error);
      }
    }
    setUploading(false);
    toast({ title: "Archivos agregados" });
  };

  const handleDeleteKnowledge = async (id: string) => {
    if (!editingGpt) return;
    try {
      await fetch(`/api/gpts/${editingGpt.id}/knowledge/${id}`, { method: "DELETE" });
      setKnowledgeFiles(prev => prev.filter(k => k.id !== id));
    } catch (error) {
      console.error("Error deleting knowledge:", error);
    }
  };

  const handleDeleteGpt = async () => {
    if (!editingGpt) return;
    if (!confirm("¿Estás seguro de que quieres eliminar este GPT?")) return;
    
    try {
      const response = await fetch(`/api/gpts/${editingGpt.id}`, { method: "DELETE" });
      if (response.ok) {
        toast({ title: "GPT eliminado" });
        onOpenChange(false);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo eliminar el GPT",
        variant: "destructive"
      });
    }
  };

  const handleDuplicateGpt = async () => {
    if (!editingGpt) return;
    try {
      const response = await fetch("/api/gpts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${formData.name} (copia)`,
          slug: generateSlug(`${formData.name}-copia-${Date.now()}`),
          description: formData.description,
          avatar: avatarPreview,
          systemPrompt: formData.systemPrompt,
          welcomeMessage: formData.welcomeMessage,
          temperature: formData.temperature.toString(),
          topP: formData.topP.toString(),
          maxTokens: formData.maxTokens,
          visibility: formData.visibility,
          conversationStarters: formData.conversationStarters.filter(s => s.trim()),
          capabilities: formData.capabilities,
          recommendedModel: formData.recommendedModel || null
        })
      });
      if (response.ok) {
        toast({ title: "GPT duplicado" });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo duplicar el GPT",
        variant: "destructive"
      });
    }
  };

  const addConversationStarter = () => {
    setFormData(prev => ({
      ...prev,
      conversationStarters: [...prev.conversationStarters, ""]
    }));
    setHasChanges(true);
  };

  const removeConversationStarter = (index: number) => {
    setFormData(prev => ({
      ...prev,
      conversationStarters: prev.conversationStarters.filter((_, i) => i !== index)
    }));
    setHasChanges(true);
  };

  const updateConversationStarter = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      conversationStarters: prev.conversationStarters.map((s, i) => i === index ? value : s)
    }));
    setHasChanges(true);
  };

  const handleCreateAction = () => {
    if (!editingGpt) {
      toast({
        title: "Guarda primero",
        description: "Guarda el GPT antes de crear acciones",
        variant: "destructive"
      });
      return;
    }
    setEditingAction(null);
    setActionForm({ name: "", description: "", httpMethod: "GET", endpoint: "", authType: "none" });
    setShowActionEditor(true);
  };

  const saveAction = async () => {
    if (!editingGpt || !actionForm.name.trim() || !actionForm.endpoint.trim()) {
      toast({
        title: "Error",
        description: "Nombre y endpoint son requeridos",
        variant: "destructive"
      });
      return;
    }
    
    try {
      if (editingAction) {
        const response = await fetch(`/api/gpts/${editingGpt.id}/actions/${editingAction.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(actionForm)
        });
        if (response.ok) {
          const updated = await response.json();
          setActions(prev => prev.map(a => a.id === updated.id ? updated : a));
          toast({ title: "Acción actualizada" });
        }
      } else {
        const response = await fetch(`/api/gpts/${editingGpt.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(actionForm)
        });
        if (response.ok) {
          const newAction = await response.json();
          setActions(prev => [newAction, ...prev]);
          toast({ title: "Acción creada" });
        }
      }
      setShowActionEditor(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la acción",
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none rounded-none p-0 gap-0 overflow-hidden" data-testid="gpt-builder-dialog">
        <div className="flex flex-col h-full bg-background">
          <header className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8"
                data-testid="button-back"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">🤖</span>
                  )}
                </div>
                <div>
                  <h1 className="font-semibold text-sm">{formData.name || "Nuevo GPT"}</h1>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <span className="text-xs text-muted-foreground">Activo</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges && (
                <span className="text-sm text-muted-foreground">Actualizaciones pendientes</span>
              )}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-more-options">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => {
                    if (editingGpt) {
                      navigator.clipboard.writeText(`${window.location.origin}/gpt/${editingGpt.slug}`);
                      toast({ title: "Enlace copiado" });
                    }
                  }}>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Copiar enlace
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Revertir...
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <History className="h-4 w-4 mr-2" />
                    Historial de las versiones
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDuplicateGpt}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicar GPT
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDeleteGpt} className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Eliminar GPT
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" size="sm" data-testid="button-share">
                <LinkIcon className="h-4 w-4 mr-2" />
                Compartir
              </Button>
              
              <Button 
                size="sm" 
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="bg-green-600 hover:bg-green-700"
                data-testid="button-update"
              >
                {saving ? "Guardando..." : "Actualizar"}
              </Button>
            </div>
          </header>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col border-r">
              <div className="flex justify-center gap-4 py-4 border-b">
                <button
                  onClick={() => setActiveTab("crear")}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-full transition-colors",
                    activeTab === "crear" 
                      ? "bg-muted text-foreground" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="tab-crear"
                >
                  Crear
                </button>
                <button
                  onClick={() => setActiveTab("configurar")}
                  className={cn(
                    "px-6 py-2 text-sm font-medium rounded-full transition-colors",
                    activeTab === "configurar" 
                      ? "bg-muted text-foreground" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="tab-configurar"
                >
                  Configurar
                </button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-6 max-w-2xl mx-auto space-y-6">
                  {activeTab === "crear" ? (
                    <div className="space-y-4">
                      <p className="text-muted-foreground text-sm">
                        Usa la conversación para configurar tu GPT. Describe cómo quieres que se comporte y qué debería saber.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-center mb-6">
                        <button 
                          className="w-20 h-20 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-muted-foreground/50 transition-colors overflow-hidden"
                          onClick={() => avatarInputRef.current?.click()}
                          data-testid="button-upload-avatar"
                        >
                          {avatarPreview ? (
                            <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <Plus className="h-8 w-8 text-muted-foreground/50" />
                          )}
                        </button>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarUpload}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="name">Nombre</Label>
                        <Input
                          id="name"
                          placeholder="Escribe un nombre para tu GPT"
                          value={formData.name}
                          onChange={(e) => handleFormChange({ name: e.target.value, slug: generateSlug(e.target.value) })}
                          data-testid="input-gpt-name"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">Descripción</Label>
                        <Input
                          id="description"
                          placeholder="Añade una breve descripción sobre qué hace este GPT"
                          value={formData.description}
                          onChange={(e) => handleFormChange({ description: e.target.value })}
                          data-testid="input-gpt-description"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="instructions">Instrucciones</Label>
                        <Textarea
                          id="instructions"
                          placeholder="¿Qué hace este GPT? ¿Cómo se comporta? ¿Qué debería evitar hacer?"
                          value={formData.systemPrompt}
                          onChange={(e) => handleFormChange({ systemPrompt: e.target.value })}
                          className="min-h-[200px] resize-none"
                          maxLength={8000}
                          data-testid="input-gpt-instructions"
                        />
                        <p className="text-xs text-muted-foreground text-right">
                          {formData.systemPrompt.length}/8,000 caracteres
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Las conversaciones con tu GPT pueden potencialmente incluir todas las instrucciones proporcionadas o parte de ellas.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Frases para iniciar una conversación</Label>
                        {formData.conversationStarters.map((starter, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              placeholder="Escribe una frase de inicio..."
                              value={starter}
                              onChange={(e) => updateConversationStarter(index, e.target.value)}
                              data-testid={`input-starter-${index}`}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeConversationStarter(index)}
                              className="h-8 w-8 flex-shrink-0"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={addConversationStarter}
                          className="text-muted-foreground"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Añadir frase
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <Label>Conocimientos</Label>
                        <p className="text-xs text-muted-foreground">
                          Las conversaciones con tu GPT pueden potencialmente revelar todos los archivos cargados o parte de ellos.
                        </p>
                        
                        {knowledgeFiles.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {knowledgeFiles.map((file) => (
                              <div key={file.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm">{file.fileName}</span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteKnowledge(file.id)}
                                  className="h-6 w-6"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          data-testid="button-upload-files"
                        >
                          {uploading ? "Subiendo..." : "Cargar archivos"}
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          accept=".pdf,.txt,.docx,.xlsx,.csv,.json"
                          onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-1">
                          <Label>Modelo recomendado</Label>
                          <HelpCircle className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Recomienda al usuario un modelo que debería usarse de manera predeterminada para obtener los mejores resultados.
                        </p>
                        <Select
                          value={formData.recommendedModel}
                          onValueChange={(value) => handleFormChange({ recommendedModel: value })}
                        >
                          <SelectTrigger data-testid="select-model">
                            <SelectValue placeholder="Ningún modelo recomendado: los usuarios podrán usar el modelo que prefieran." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Ningún modelo recomendado</SelectItem>
                            <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                            <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                            <SelectItem value="gpt-o1">GPT-o1</SelectItem>
                            <SelectItem value="gpt-o3-mini">GPT-o3-mini</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-3">
                        <Label>Funcionalidades</Label>
                        
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="web-browsing"
                            checked={formData.capabilities.webBrowsing}
                            onCheckedChange={(checked) => 
                              handleFormChange({ 
                                capabilities: { ...formData.capabilities, webBrowsing: !!checked }
                              })
                            }
                          />
                          <label htmlFor="web-browsing" className="text-sm">
                            Búsqueda en la web
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="canvas"
                            checked={formData.capabilities.canvas}
                            onCheckedChange={(checked) => 
                              handleFormChange({ 
                                capabilities: { ...formData.capabilities, canvas: !!checked }
                              })
                            }
                          />
                          <label htmlFor="canvas" className="text-sm">
                            Lienzo
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="image-generation"
                            checked={formData.capabilities.imageGeneration}
                            onCheckedChange={(checked) => 
                              handleFormChange({ 
                                capabilities: { ...formData.capabilities, imageGeneration: !!checked }
                              })
                            }
                          />
                          <label htmlFor="image-generation" className="text-sm">
                            Generación de imagen
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="code-interpreter"
                            checked={formData.capabilities.codeInterpreter}
                            onCheckedChange={(checked) => 
                              handleFormChange({ 
                                capabilities: { ...formData.capabilities, codeInterpreter: !!checked }
                              })
                            }
                          />
                          <label htmlFor="code-interpreter" className="text-sm flex items-center gap-1">
                            Intérprete de código y análisis de datos
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </label>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Acciones</Label>
                        
                        {actions.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {actions.map((action) => (
                              <div key={action.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                    {action.httpMethod}
                                  </span>
                                  <span className="text-sm">{action.name}</span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditingAction(action);
                                    setActionForm({
                                      name: action.name,
                                      description: action.description || "",
                                      httpMethod: action.httpMethod,
                                      endpoint: action.endpoint,
                                      authType: action.authType
                                    });
                                    setShowActionEditor(true);
                                  }}
                                  className="h-6 w-6"
                                >
                                  <MoreHorizontal className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCreateAction}
                          data-testid="button-create-action"
                        >
                          Crear nueva acción
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="w-[400px] flex flex-col bg-muted/20">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <span className="text-sm font-medium">Vista previa</span>
                <Select defaultValue="5.2">
                  <SelectTrigger className="w-[120px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5.2">Modelo 5.2</SelectItem>
                    <SelectItem value="4o">GPT-4o</SelectItem>
                    <SelectItem value="4o-mini">GPT-4o mini</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4 overflow-hidden">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">🤖</span>
                  )}
                </div>
                <p className="text-sm text-center text-muted-foreground max-w-xs">
                  {formData.description || "Vista previa de tu GPT"}
                </p>
              </div>

              <div className="p-4 border-t">
                <div className="flex items-center gap-2 p-3 bg-background rounded-full border">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Pregunta lo que quieras"
                    value={previewMessage}
                    onChange={(e) => setPreviewMessage(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-sm"
                    data-testid="input-preview-message"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button 
                    size="icon" 
                    className="h-8 w-8 rounded-full"
                    disabled={!previewMessage.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showActionEditor && (
          <Dialog open={showActionEditor} onOpenChange={setShowActionEditor}>
            <DialogContent className="sm:max-w-[500px]" data-testid="action-editor-dialog">
              <DialogHeader>
                <DialogTitle>{editingAction ? "Editar acción" : "Nueva acción"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="action-name">Nombre</Label>
                  <Input
                    id="action-name"
                    placeholder="Ej: Consultar clima"
                    value={actionForm.name}
                    onChange={(e) => setActionForm(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1"
                    data-testid="input-action-name"
                  />
                </div>
                <div>
                  <Label htmlFor="action-description">Descripción</Label>
                  <Textarea
                    id="action-description"
                    placeholder="Describe lo que hace esta acción..."
                    value={actionForm.description}
                    onChange={(e) => setActionForm(prev => ({ ...prev, description: e.target.value }))}
                    className="mt-1"
                    data-testid="input-action-description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Método HTTP</Label>
                    <div className="flex gap-1 mt-1">
                      {["GET", "POST", "PUT", "DELETE"].map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={actionForm.httpMethod === method ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActionForm(prev => ({ ...prev, httpMethod: method }))}
                        >
                          {method}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Autenticación</Label>
                    <div className="flex gap-1 mt-1">
                      {[{ value: "none", label: "Ninguna" }, { value: "api_key", label: "API Key" }].map((auth) => (
                        <Button
                          key={auth.value}
                          type="button"
                          variant={actionForm.authType === auth.value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActionForm(prev => ({ ...prev, authType: auth.value }))}
                        >
                          {auth.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="action-endpoint">Endpoint URL</Label>
                  <Input
                    id="action-endpoint"
                    placeholder="https://api.example.com/endpoint"
                    value={actionForm.endpoint}
                    onChange={(e) => setActionForm(prev => ({ ...prev, endpoint: e.target.value }))}
                    className="mt-1 font-mono text-sm"
                    data-testid="input-action-endpoint"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setShowActionEditor(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={saveAction} data-testid="button-save-action">
                    {editingAction ? "Actualizar" : "Crear"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
