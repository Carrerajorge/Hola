import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Zap, 
  Plus, 
  X, 
  FileText, 
  Database, 
  Globe, 
  Sparkles,
  Code,
  AlertCircle,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { UserSkill } from "@/hooks/use-user-skills";

interface SkillBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (skill: Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">) => void;
  editingSkill?: UserSkill | null;
}

const CATEGORY_OPTIONS = [
  { value: "documents", label: "Documentos", icon: FileText },
  { value: "data", label: "Datos", icon: Database },
  { value: "integrations", label: "Integraciones", icon: Globe },
  { value: "custom", label: "Personalizado", icon: Sparkles },
];

const EXAMPLE_TEMPLATES = [
  {
    name: "Asistente de Código",
    description: "Ayuda con revisión de código, debugging y mejores prácticas.",
    instructions: `# Asistente de Código

## Instrucciones
Cuando el usuario pida ayuda con código:
1. Analiza el código proporcionado
2. Identifica problemas potenciales
3. Sugiere mejoras siguiendo mejores prácticas
4. Explica los cambios propuestos

## Mejores Prácticas
- Usa nombres descriptivos para variables
- Mantén funciones pequeñas y enfocadas
- Agrega comentarios cuando sea necesario
- Sigue los principios SOLID`,
    category: "custom" as const,
    features: ["Revisión de código", "Debugging", "Refactoring", "Documentación"],
  },
  {
    name: "Generador de Reportes",
    description: "Crea reportes profesionales a partir de datos estructurados.",
    instructions: `# Generador de Reportes

## Instrucciones
Para generar un reporte:
1. Analiza los datos proporcionados
2. Identifica métricas clave
3. Crea visualizaciones apropiadas
4. Resume hallazgos principales

## Formato de Salida
- Título y fecha
- Resumen ejecutivo
- Métricas principales
- Gráficos y tablas
- Conclusiones y recomendaciones`,
    category: "data" as const,
    features: ["Análisis de datos", "Visualizaciones", "Resúmenes", "Exportar PDF"],
  },
];

export function SkillBuilder({ open, onOpenChange, onSave, editingSkill }: SkillBuilderProps) {
  const [activeTab, setActiveTab] = useState("basic");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [category, setCategory] = useState<"documents" | "data" | "integrations" | "custom">("custom");
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editingSkill) {
      setName(editingSkill.name);
      setDescription(editingSkill.description);
      setInstructions(editingSkill.instructions);
      setCategory(editingSkill.category);
      setFeatures(editingSkill.features);
    } else {
      resetForm();
    }
  }, [editingSkill, open]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstructions("");
    setCategory("custom");
    setFeatures([]);
    setNewFeature("");
    setErrors({});
    setActiveTab("basic");
  };

  const addFeature = () => {
    if (newFeature.trim() && !features.includes(newFeature.trim())) {
      setFeatures([...features, newFeature.trim()]);
      setNewFeature("");
    }
  };

  const removeFeature = (feature: string) => {
    setFeatures(features.filter(f => f !== feature));
  };

  const applyTemplate = (template: typeof EXAMPLE_TEMPLATES[0]) => {
    setName(template.name);
    setDescription(template.description);
    setInstructions(template.instructions);
    setCategory(template.category);
    setFeatures(template.features);
    setActiveTab("instructions");
    toast.success("Plantilla aplicada");
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!name.trim()) {
      newErrors.name = "El nombre es requerido";
    } else if (name.length > 64) {
      newErrors.name = "El nombre no puede tener más de 64 caracteres";
    }
    
    if (!description.trim()) {
      newErrors.description = "La descripción es requerida";
    } else if (description.length > 1024) {
      newErrors.description = "La descripción no puede tener más de 1024 caracteres";
    }
    
    if (!instructions.trim()) {
      newErrors.instructions = "Las instrucciones son requeridas";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) {
      toast.error("Por favor corrige los errores");
      return;
    }

    onSave({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      category,
      enabled: true,
      features,
    });

    resetForm();
    onOpenChange(false);
    toast.success(editingSkill ? "Skill actualizado" : "Skill creado");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] p-0 gap-0" data-testid="skill-builder-dialog">
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Zap className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <DialogTitle className="text-xl">
                {editingSkill ? "Editar Skill" : "Crear Skill"}
              </DialogTitle>
              <DialogDescription>
                Define las instrucciones y capacidades de tu Skill personalizado
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="px-6 pt-4 border-b">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="basic" data-testid="tab-basic">Información</TabsTrigger>
              <TabsTrigger value="instructions" data-testid="tab-instructions">Instrucciones</TabsTrigger>
              <TabsTrigger value="templates" data-testid="tab-templates">Plantillas</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 p-6">
            <TabsContent value="basic" className="mt-0 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="skill-name">Nombre del Skill *</Label>
                <Input
                  id="skill-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ej: asistente-ventas"
                  className={cn(errors.name && "border-red-500")}
                  maxLength={64}
                  data-testid="input-skill-name"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{errors.name && <span className="text-red-500">{errors.name}</span>}</span>
                  <span>{name.length}/64</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="skill-description">Descripción *</Label>
                <Textarea
                  id="skill-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe qué hace este Skill y cuándo debe usarse..."
                  className={cn("min-h-[100px]", errors.description && "border-red-500")}
                  maxLength={1024}
                  data-testid="input-skill-description"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{errors.description && <span className="text-red-500">{errors.description}</span>}</span>
                  <span>{description.length}/1024</span>
                </div>
                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  Incluye cuándo debe activarse este Skill (ej: "cuando el usuario mencione ventas o CRM")
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="skill-category">Categoría</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger id="skill-category" data-testid="select-skill-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <opt.icon className="h-4 w-4" />
                          {opt.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Capacidades</Label>
                <div className="flex gap-2">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    placeholder="Agregar capacidad..."
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFeature())}
                    data-testid="input-new-feature"
                  />
                  <Button type="button" variant="outline" onClick={addFeature} data-testid="button-add-feature">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {features.map((feature, i) => (
                    <Badge key={i} variant="secondary" className="gap-1 pr-1">
                      {feature}
                      <button
                        onClick={() => removeFeature(feature)}
                        className="ml-1 hover:bg-muted rounded p-0.5"
                        data-testid={`remove-feature-${i}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {features.length === 0 && (
                    <span className="text-sm text-muted-foreground">Sin capacidades definidas</span>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="instructions" className="mt-0 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="skill-instructions">Instrucciones del Skill *</Label>
                  <Badge variant="outline" className="text-xs">Markdown soportado</Badge>
                </div>
                <Textarea
                  id="skill-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={`# Mi Skill

## Instrucciones
Describe paso a paso cómo debe comportarse el asistente...

## Ejemplos
Proporciona ejemplos de uso...`}
                  className={cn("min-h-[400px] font-mono text-sm", errors.instructions && "border-red-500")}
                  data-testid="textarea-skill-instructions"
                />
                {errors.instructions && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.instructions}
                  </p>
                )}
              </div>

              <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  Estructura recomendada
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• <strong># Nombre</strong> - Título del Skill</li>
                  <li>• <strong>## Instrucciones</strong> - Guía paso a paso</li>
                  <li>• <strong>## Ejemplos</strong> - Casos de uso concretos</li>
                  <li>• <strong>## Restricciones</strong> - Límites y reglas</li>
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="templates" className="mt-0">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Usa una plantilla como punto de partida para tu Skill personalizado.
                </p>
                
                <div className="grid gap-4">
                  {EXAMPLE_TEMPLATES.map((template, i) => (
                    <div
                      key={i}
                      className="p-4 border rounded-lg hover:border-primary/50 transition-colors cursor-pointer"
                      onClick={() => applyTemplate(template)}
                      data-testid={`template-${i}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium">{template.name}</h4>
                          <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {template.features.slice(0, 3).map((f, j) => (
                              <Badge key={j} variant="outline" className="text-xs">{f}</Badge>
                            ))}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm">
                          Usar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancelar
          </Button>
          <Button onClick={handleSave} data-testid="button-save-skill">
            {editingSkill ? "Guardar Cambios" : "Crear Skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
