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
  Link as LinkIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Gpt } from "./gpt-explorer";

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
      imageGeneration: false
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
          imageGeneration: false
        }
      });
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
          imageGeneration: false
        }
      });
    }
  }, [editingGpt, open]);

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
      <DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 overflow-hidden" data-testid="gpt-builder-dialog">
        <div className="flex h-full">
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-4">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="bg-muted/50">
                    <TabsTrigger value="create" data-testid="tab-create">Crear</TabsTrigger>
                    <TabsTrigger value="configure" data-testid="tab-configure">Configurar</TabsTrigger>
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
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="w-80 border-l bg-muted/30 flex flex-col">
            <div className="p-4 border-b">
              <h3 className="font-medium">Vista previa</h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4">
                <div className="bg-background rounded-lg p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{formData.name || "Nombre del GPT"}</p>
                      <p className="text-xs text-muted-foreground">{formData.description || "Sin descripción"}</p>
                    </div>
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
