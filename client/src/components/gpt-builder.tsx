import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bot, 
  Settings2, 
  MessageSquare, 
  Plus,
  X,
  Save,
  Trash2,
  Copy,
  Globe,
  Lock,
  Link as LinkIcon,
  Upload,
  FileText,
  File,
  Zap,
  Play,
  Code,
  Send
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

export function GptBuilder({ open, onOpenChange, editingGpt, onSave }: GptBuilderProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("create");
  const [saving, setSaving] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<GptKnowledge[]>([]);
  const [actions, setActions] = useState<GptAction[]>([]);
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewResponse, setPreviewResponse] = useState("");
  const [testingPreview, setTestingPreview] = useState(false);
  
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
    conversationStarters: ["", "", "", ""],
    capabilities: {
      webBrowsing: true,
      codeInterpreter: true,
      imageGeneration: false,
      wordCreation: true,
      excelCreation: true,
      pptCreation: true
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
        conversationStarters: Array.isArray(editingGpt.conversationStarters) 
          ? [...editingGpt.conversationStarters, "", "", "", ""].slice(0, 4)
          : ["", "", "", ""],
        capabilities: editingGpt.capabilities || {
          webBrowsing: true,
          codeInterpreter: true,
          imageGeneration: false,
          wordCreation: true,
          excelCreation: true,
          pptCreation: true
        }
      });
      loadKnowledgeAndActions(editingGpt.id);
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
        conversationStarters: ["", "", "", ""],
        capabilities: {
          webBrowsing: true,
          codeInterpreter: true,
          imageGeneration: false,
          wordCreation: true,
          excelCreation: true,
          pptCreation: true
        }
      });
      setKnowledgeFiles([]);
      setActions([]);
    }
    setPreviewMessage("");
    setPreviewResponse("");
  }, [editingGpt, open]);

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

  const generateSlug = (name: string, addSuffix = false) => {
    let slug = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    
    if (addSuffix) {
      slug += "-" + Date.now().toString(36);
    }
    return slug;
  };

  const handleNameChange = (name: string) => {
    setFormData(prev => ({
      ...prev,
      name,
      slug: editingGpt ? prev.slug : generateSlug(name)
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" });
      return;
    }
    if (!formData.systemPrompt.trim()) {
      toast({ title: "Error", description: "Las instrucciones son requeridas", variant: "destructive" });
      return;
    }

    try {
      setSaving(true);
      
      const cleanedStarters = formData.conversationStarters.filter(s => s.trim());
      
      const payload = {
        name: formData.name,
        slug: formData.slug || generateSlug(formData.name),
        description: formData.description || null,
        systemPrompt: formData.systemPrompt,
        welcomeMessage: formData.welcomeMessage || null,
        temperature: formData.temperature.toString(),
        topP: formData.topP.toString(),
        maxTokens: formData.maxTokens,
        visibility: formData.visibility,
        conversationStarters: cleanedStarters.length > 0 ? cleanedStarters : null,
        capabilities: formData.capabilities,
        isPublished: formData.visibility === "public" ? "true" : "false"
      };

      let response;
      if (editingGpt) {
        response = await fetch(`/api/gpts/${editingGpt.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        response = await fetch("/api/gpts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        
        if (response.status === 409) {
          payload.slug = generateSlug(formData.name, true);
          response = await fetch("/api/gpts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        }
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al guardar");
      }

      const savedGpt = await response.json();
      toast({ 
        title: editingGpt ? "GPT actualizado" : "GPT creado",
        description: `${savedGpt.name} ha sido ${editingGpt ? "actualizado" : "creado"} exitosamente.`
      });
      
      onSave?.(savedGpt);
      onOpenChange(false);
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: error.message || "No se pudo guardar el GPT",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingGpt) return;
    
    if (!confirm("¿Estás seguro de que deseas eliminar este GPT?")) return;

    try {
      const response = await fetch(`/api/gpts/${editingGpt.id}`, {
        method: "DELETE"
      });

      if (!response.ok) throw new Error("Error al eliminar");

      toast({ title: "GPT eliminado", description: "El GPT ha sido eliminado exitosamente." });
      onOpenChange(false);
    } catch (error) {
      toast({ 
        title: "Error", 
        description: "No se pudo eliminar el GPT",
        variant: "destructive"
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[100vw] max-w-[100vw] h-[100vh] p-0 gap-0 overflow-hidden rounded-none" data-testid="gpt-builder-dialog">
        <div className="flex h-full overflow-hidden">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-4">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="bg-muted/50">
                    <TabsTrigger value="create" data-testid="tab-create">
                      <Bot className="h-4 w-4 mr-1.5" />
                      Crear
                    </TabsTrigger>
                    <TabsTrigger value="knowledge" data-testid="tab-knowledge">
                      <FileText className="h-4 w-4 mr-1.5" />
                      Conocimiento
                    </TabsTrigger>
                    <TabsTrigger value="actions" data-testid="tab-actions">
                      <Zap className="h-4 w-4 mr-1.5" />
                      Acciones
                    </TabsTrigger>
                    <TabsTrigger value="configure" data-testid="tab-configure">
                      <Settings2 className="h-4 w-4 mr-1.5" />
                      Configurar
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex items-center gap-2">
                {editingGpt && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleDelete}
                    className="text-destructive hover:text-destructive"
                    data-testid="button-delete-gpt"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button 
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="button-save-gpt"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-6 space-y-6">
                {activeTab === "create" && (
                  <>
                    <div className="flex items-start gap-4">
                      <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center cursor-pointer hover:bg-muted/80 transition-colors">
                        <Bot className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <div className="flex-1 space-y-4">
                        <div>
                          <Label htmlFor="name">Nombre</Label>
                          <Input
                            id="name"
                            placeholder="Ej: Asistente de Investigación"
                            value={formData.name}
                            onChange={(e) => handleNameChange(e.target.value)}
                            className="mt-1"
                            data-testid="input-gpt-name"
                          />
                        </div>
                        <div>
                          <Label htmlFor="slug">Identificador (slug)</Label>
                          <Input
                            id="slug"
                            placeholder="asistente-investigacion"
                            value={formData.slug}
                            onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                            className="mt-1"
                            disabled={!!editingGpt}
                            data-testid="input-gpt-slug"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="description">Descripción</Label>
                      <Textarea
                        id="description"
                        placeholder="Una breve descripción de lo que hace este GPT..."
                        value={formData.description}
                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        className="mt-1 min-h-[80px]"
                        data-testid="input-gpt-description"
                      />
                    </div>

                    <div>
                      <Label htmlFor="systemPrompt">Instrucciones</Label>
                      <p className="text-sm text-muted-foreground mb-2">
                        ¿Qué hace este GPT? ¿Cómo se comporta? ¿Qué debe evitar hacer?
                      </p>
                      <Textarea
                        id="systemPrompt"
                        placeholder="Eres un asistente especializado en investigación académica. Tu rol es ayudar a los usuarios a encontrar fuentes confiables, estructurar sus argumentos y redactar contenido académico de alta calidad..."
                        value={formData.systemPrompt}
                        onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                        className="mt-1 min-h-[200px] font-mono text-sm"
                        data-testid="input-gpt-system-prompt"
                      />
                    </div>

                    <div>
                      <Label>Iniciadores de conversación</Label>
                      <p className="text-sm text-muted-foreground mb-2">
                        Sugerencias que aparecerán al inicio de la conversación.
                      </p>
                      <div className="space-y-2">
                        {formData.conversationStarters.map((starter, index) => (
                          <Input
                            key={index}
                            placeholder={`Iniciador ${index + 1}`}
                            value={starter}
                            onChange={(e) => {
                              const newStarters = [...formData.conversationStarters];
                              newStarters[index] = e.target.value;
                              setFormData(prev => ({ ...prev, conversationStarters: newStarters }));
                            }}
                            data-testid={`input-starter-${index}`}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="welcomeMessage">Mensaje de bienvenida</Label>
                      <Textarea
                        id="welcomeMessage"
                        placeholder="¡Hola! Soy tu asistente de investigación. ¿En qué tema te gustaría profundizar hoy?"
                        value={formData.welcomeMessage}
                        onChange={(e) => setFormData(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                        className="mt-1"
                        data-testid="input-gpt-welcome"
                      />
                    </div>
                  </>
                )}

                {activeTab === "knowledge" && (
                  <>
                    <div className="space-y-4">
                      <div>
                        <Label>Base de conocimiento</Label>
                        <p className="text-sm text-muted-foreground mb-4">
                          Sube archivos para que tu GPT pueda usar como referencia. Soporta PDF, TXT, DOCX, XLSX y más.
                        </p>
                        
                        <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                          onClick={() => document.getElementById("file-upload")?.click()}
                          data-testid="knowledge-upload-zone"
                        >
                          <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                          <p className="font-medium">Arrastra archivos aquí o haz clic para subir</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            PDF, TXT, DOCX, XLSX, CSV, JSON (máx. 20MB)
                          </p>
                          <input
                            id="file-upload"
                            type="file"
                            multiple
                            accept=".pdf,.txt,.docx,.xlsx,.csv,.json,.md"
                            className="hidden"
                            onChange={(e) => {
                              const files = e.target.files;
                              if (files && editingGpt) {
                                Array.from(files).forEach(async (file) => {
                                  toast({
                                    title: "Archivo detectado",
                                    description: `${file.name} - La subida se implementará con Object Storage`
                                  });
                                });
                              } else if (!editingGpt) {
                                toast({
                                  title: "Guarda primero",
                                  description: "Guarda el GPT antes de agregar archivos",
                                  variant: "destructive"
                                });
                              }
                            }}
                            data-testid="file-input"
                          />
                        </div>
                      </div>

                      {knowledgeFiles.length > 0 && (
                        <div className="space-y-2">
                          <Label>Archivos cargados ({knowledgeFiles.length})</Label>
                          {knowledgeFiles.map((file) => (
                            <div key={file.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`knowledge-file-${file.id}`}>
                              <div className="flex items-center gap-3">
                                <File className="h-5 w-5 text-muted-foreground" />
                                <div>
                                  <p className="font-medium text-sm">{file.fileName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {(file.fileSize / 1024).toFixed(1)} KB - {file.embeddingStatus}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (editingGpt) {
                                    await fetch(`/api/gpts/${editingGpt.id}/knowledge/${file.id}`, { method: "DELETE" });
                                    setKnowledgeFiles(prev => prev.filter(f => f.id !== file.id));
                                    toast({ title: "Archivo eliminado" });
                                  }
                                }}
                                data-testid={`delete-knowledge-${file.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {knowledgeFiles.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No hay archivos en la base de conocimiento</p>
                          <p className="text-sm">Sube archivos para que el GPT pueda usarlos como referencia</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeTab === "actions" && (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Acciones personalizadas</Label>
                          <p className="text-sm text-muted-foreground">
                            Conecta APIs externas para que tu GPT pueda realizar acciones.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (!editingGpt) {
                              toast({
                                title: "Guarda primero",
                                description: "Guarda el GPT antes de agregar acciones",
                                variant: "destructive"
                              });
                              return;
                            }
                            toast({
                              title: "Crear acción",
                              description: "El editor de acciones se abrirá aquí"
                            });
                          }}
                          data-testid="button-add-action"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Nueva acción
                        </Button>
                      </div>

                      {actions.length > 0 && (
                        <div className="space-y-2">
                          {actions.map((action) => (
                            <div key={action.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`action-${action.id}`}>
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                  <Code className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                  <p className="font-medium">{action.name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {action.httpMethod} {action.endpoint}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {action.usageCount} usos
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async () => {
                                    if (editingGpt) {
                                      await fetch(`/api/gpts/${editingGpt.id}/actions/${action.id}`, { method: "DELETE" });
                                      setActions(prev => prev.filter(a => a.id !== action.id));
                                      toast({ title: "Acción eliminada" });
                                    }
                                  }}
                                  data-testid={`delete-action-${action.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {actions.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                          <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p className="font-medium">Sin acciones personalizadas</p>
                          <p className="text-sm">Las acciones permiten a tu GPT interactuar con APIs externas</p>
                        </div>
                      )}

                      <div className="pt-4 border-t">
                        <Label className="text-base">Ejemplos de acciones</Label>
                        <div className="grid gap-2 mt-3">
                          <button className="flex items-start gap-3 p-3 border rounded-lg text-left hover:bg-muted/50 transition-colors">
                            <Globe className="h-5 w-5 text-blue-500 mt-0.5" />
                            <div>
                              <p className="font-medium text-sm">Consultar API del clima</p>
                              <p className="text-xs text-muted-foreground">Obtén información meteorológica en tiempo real</p>
                            </div>
                          </button>
                          <button className="flex items-start gap-3 p-3 border rounded-lg text-left hover:bg-muted/50 transition-colors">
                            <Code className="h-5 w-5 text-green-500 mt-0.5" />
                            <div>
                              <p className="font-medium text-sm">Buscar en base de datos</p>
                              <p className="text-xs text-muted-foreground">Consulta información de tu sistema</p>
                            </div>
                          </button>
                          <button className="flex items-start gap-3 p-3 border rounded-lg text-left hover:bg-muted/50 transition-colors">
                            <Send className="h-5 w-5 text-purple-500 mt-0.5" />
                            <div>
                              <p className="font-medium text-sm">Enviar notificaciones</p>
                              <p className="text-xs text-muted-foreground">Envía emails o mensajes de Slack</p>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === "configure" && (
                  <>
                    <div className="space-y-6">
                      <div>
                        <Label>Visibilidad</Label>
                        <div className="flex gap-2 mt-2">
                          <Button
                            variant={formData.visibility === "private" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData(prev => ({ ...prev, visibility: "private" }))}
                            data-testid="button-visibility-private"
                          >
                            <Lock className="h-4 w-4 mr-2" />
                            Privado
                          </Button>
                          <Button
                            variant={formData.visibility === "unlisted" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData(prev => ({ ...prev, visibility: "unlisted" }))}
                            data-testid="button-visibility-unlisted"
                          >
                            <LinkIcon className="h-4 w-4 mr-2" />
                            Solo con enlace
                          </Button>
                          <Button
                            variant={formData.visibility === "public" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFormData(prev => ({ ...prev, visibility: "public" }))}
                            data-testid="button-visibility-public"
                          >
                            <Globe className="h-4 w-4 mr-2" />
                            Público
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Label>Temperatura: {formData.temperature.toFixed(1)}</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Controla la creatividad de las respuestas. Mayor = más creativo, menor = más predecible.
                        </p>
                        <Slider
                          value={[formData.temperature]}
                          onValueChange={([value]) => setFormData(prev => ({ ...prev, temperature: value }))}
                          min={0}
                          max={2}
                          step={0.1}
                          className="mt-2"
                          data-testid="slider-temperature"
                        />
                      </div>

                      <div>
                        <Label>Top P: {formData.topP.toFixed(1)}</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Controla la diversidad de tokens. Valores más bajos hacen las respuestas más enfocadas.
                        </p>
                        <Slider
                          value={[formData.topP]}
                          onValueChange={([value]) => setFormData(prev => ({ ...prev, topP: value }))}
                          min={0}
                          max={1}
                          step={0.05}
                          className="mt-2"
                          data-testid="slider-top-p"
                        />
                      </div>

                      <div>
                        <Label>Tokens máximos: {formData.maxTokens}</Label>
                        <p className="text-sm text-muted-foreground mb-2">
                          Límite de tokens para cada respuesta.
                        </p>
                        <Slider
                          value={[formData.maxTokens]}
                          onValueChange={([value]) => setFormData(prev => ({ ...prev, maxTokens: value }))}
                          min={256}
                          max={8192}
                          step={256}
                          className="mt-2"
                          data-testid="slider-max-tokens"
                        />
                      </div>

                      <div className="space-y-4">
                        <Label>Capacidades</Label>
                        
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Navegación web</p>
                            <p className="text-sm text-muted-foreground">Permite buscar información en internet.</p>
                          </div>
                          <Switch
                            checked={formData.capabilities.webBrowsing}
                            onCheckedChange={(checked) => setFormData(prev => ({
                              ...prev,
                              capabilities: { ...prev.capabilities, webBrowsing: checked }
                            }))}
                            data-testid="switch-web-browsing"
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Intérprete de código</p>
                            <p className="text-sm text-muted-foreground">Permite ejecutar código Python.</p>
                          </div>
                          <Switch
                            checked={formData.capabilities.codeInterpreter}
                            onCheckedChange={(checked) => setFormData(prev => ({
                              ...prev,
                              capabilities: { ...prev.capabilities, codeInterpreter: checked }
                            }))}
                            data-testid="switch-code-interpreter"
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Generación de imágenes</p>
                            <p className="text-sm text-muted-foreground">Permite crear imágenes con DALL-E.</p>
                          </div>
                          <Switch
                            checked={formData.capabilities.imageGeneration}
                            onCheckedChange={(checked) => setFormData(prev => ({
                              ...prev,
                              capabilities: { ...prev.capabilities, imageGeneration: checked }
                            }))}
                            data-testid="switch-image-generation"
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Crear en Word</p>
                            <p className="text-sm text-muted-foreground">Permite crear documentos de Word.</p>
                          </div>
                          <Switch
                            checked={formData.capabilities.wordCreation}
                            onCheckedChange={(checked) => setFormData(prev => ({
                              ...prev,
                              capabilities: { ...prev.capabilities, wordCreation: checked }
                            }))}
                            data-testid="switch-word-creation"
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Crear en Excel</p>
                            <p className="text-sm text-muted-foreground">Permite crear hojas de cálculo en Excel.</p>
                          </div>
                          <Switch
                            checked={formData.capabilities.excelCreation}
                            onCheckedChange={(checked) => setFormData(prev => ({
                              ...prev,
                              capabilities: { ...prev.capabilities, excelCreation: checked }
                            }))}
                            data-testid="switch-excel-creation"
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Crear en PowerPoint</p>
                            <p className="text-sm text-muted-foreground">Permite crear presentaciones de PowerPoint.</p>
                          </div>
                          <Switch
                            checked={formData.capabilities.pptCreation}
                            onCheckedChange={(checked) => setFormData(prev => ({
                              ...prev,
                              capabilities: { ...prev.capabilities, pptCreation: checked }
                            }))}
                            data-testid="switch-ppt-creation"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="w-96 border-l bg-muted/30 flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-medium flex items-center gap-2">
                <Play className="h-4 w-4" />
                Vista previa
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div className="bg-background rounded-lg p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <Bot className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{formData.name || "Nombre del GPT"}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{formData.description || "Sin descripción"}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {knowledgeFiles.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">
                        <FileText className="h-3 w-3" />
                        {knowledgeFiles.length} archivo{knowledgeFiles.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {actions.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                        <Zap className="h-3 w-3" />
                        {actions.length} acción{actions.length > 1 ? "es" : ""}
                      </span>
                    )}
                    {Object.entries(formData.capabilities).filter(([_, v]) => v).length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs rounded-full">
                        {Object.entries(formData.capabilities).filter(([_, v]) => v).length} capacidades
                      </span>
                    )}
                  </div>
                  
                  {formData.welcomeMessage && (
                    <div className="bg-muted rounded-lg p-3 text-sm">
                      {formData.welcomeMessage}
                    </div>
                  )}

                  {formData.conversationStarters.some(s => s.trim()) && (
                    <div className="space-y-2">
                      {formData.conversationStarters.filter(s => s.trim()).map((starter, index) => (
                        <button
                          key={index}
                          className="w-full text-left p-2 border rounded-lg text-sm hover:bg-muted/50 transition-colors"
                          onClick={() => setPreviewMessage(starter)}
                        >
                          {starter}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
