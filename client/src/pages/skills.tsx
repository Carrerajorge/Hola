import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { 
  FileSpreadsheet, 
  FileText, 
  Presentation, 
  FileType, 
  Database, 
  Code, 
  Globe, 
  Mail,
  Calculator,
  BarChart3,
  Search,
  Zap,
  Check,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Copy,
  Sparkles,
  ArrowLeft,
  Play,
  Pause,
  Settings2,
  BookOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUserSkills, UserSkill } from "@/hooks/use-user-skills";
import { SkillBuilder } from "@/components/skill-builder";

interface BuiltInSkill {
  id: string;
  name: string;
  description: string;
  category: "documents" | "data" | "integrations" | "custom";
  icon: React.ReactNode;
  enabled: boolean;
  builtIn: true;
  features: string[];
  triggers: string[];
}

type Skill = BuiltInSkill | (UserSkill & { triggers?: string[] });

const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    id: "xlsx",
    name: "Excel",
    description: "Crear hojas de cálculo, analizar datos, generar reportes con gráficos y fórmulas avanzadas.",
    category: "documents",
    icon: <FileSpreadsheet className="h-6 w-6 text-green-600" />,
    enabled: true,
    builtIn: true,
    features: ["Crear workbooks", "Fórmulas avanzadas", "Gráficos", "Formato condicional"],
    triggers: ["excel", "hoja de cálculo", "spreadsheet", "xlsx"]
  },
  {
    id: "docx",
    name: "Word",
    description: "Crear documentos profesionales, CVs, reportes, cartas y más con formato rico.",
    category: "documents",
    icon: <FileText className="h-6 w-6 text-blue-600" />,
    enabled: true,
    builtIn: true,
    features: ["Documentos profesionales", "CVs y cartas", "Tablas y listas", "Estilos"],
    triggers: ["word", "documento", "docx", "cv", "carta"]
  },
  {
    id: "pptx",
    name: "PowerPoint",
    description: "Crear presentaciones con diapositivas, gráficos y contenido visual.",
    category: "documents",
    icon: <Presentation className="h-6 w-6 text-orange-600" />,
    enabled: true,
    builtIn: true,
    features: ["Diapositivas", "Gráficos", "Imágenes", "Transiciones"],
    triggers: ["powerpoint", "presentación", "pptx", "slides"]
  },
  {
    id: "pdf",
    name: "PDF",
    description: "Extraer texto y tablas de PDFs, llenar formularios, analizar documentos.",
    category: "documents",
    icon: <FileType className="h-6 w-6 text-red-600" />,
    enabled: true,
    builtIn: true,
    features: ["Extraer texto", "Leer tablas", "Formularios", "OCR"],
    triggers: ["pdf", "extraer", "formulario"]
  },
  {
    id: "data-analysis",
    name: "Análisis de Datos",
    description: "Procesar grandes conjuntos de datos, estadísticas y visualizaciones.",
    category: "data",
    icon: <BarChart3 className="h-6 w-6 text-purple-600" />,
    enabled: true,
    builtIn: true,
    features: ["Estadísticas", "Visualizaciones", "Tendencias", "Reportes"],
    triggers: ["análisis", "datos", "estadísticas", "dashboard"]
  },
  {
    id: "formulas",
    name: "Motor de Fórmulas",
    description: "Evaluar fórmulas matemáticas, cálculos financieros y científicos.",
    category: "data",
    icon: <Calculator className="h-6 w-6 text-indigo-600" />,
    enabled: true,
    builtIn: true,
    features: ["Matemáticas", "Financieras", "Trigonometría", "Conversiones"],
    triggers: ["fórmula", "calcular", "sum", "average"]
  },
  {
    id: "web-search",
    name: "Búsqueda Web",
    description: "Buscar información actualizada en internet y fuentes académicas.",
    category: "integrations",
    icon: <Globe className="h-6 w-6 text-cyan-600" />,
    enabled: true,
    builtIn: true,
    features: ["Búsqueda web", "Noticias", "Verificación", "Citas"],
    triggers: ["buscar", "search", "internet", "web"]
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Leer y analizar correos electrónicos, buscar mensajes, resumir hilos.",
    category: "integrations",
    icon: <Mail className="h-6 w-6 text-red-500" />,
    enabled: true,
    builtIn: true,
    features: ["Leer emails", "Buscar", "Resumir", "Filtrar"],
    triggers: ["gmail", "correo", "email", "mensajes"]
  },
  {
    id: "code-execution",
    name: "Ejecución de Código",
    description: "Ejecutar código Python, JavaScript para análisis y automatización.",
    category: "data",
    icon: <Code className="h-6 w-6 text-yellow-600" />,
    enabled: false,
    builtIn: true,
    features: ["Python", "JavaScript", "Visualizaciones", "Automatización"],
    triggers: ["código", "python", "javascript", "ejecutar"]
  },
  {
    id: "database",
    name: "Base de Datos",
    description: "Consultar y analizar datos de bases de datos SQL.",
    category: "data",
    icon: <Database className="h-6 w-6 text-gray-600" />,
    enabled: false,
    builtIn: true,
    features: ["SQL", "Joins", "Agregaciones", "Exportar"],
    triggers: ["database", "sql", "consulta", "base de datos"]
  },
];

export default function SkillsPage() {
  const [, setLocation] = useLocation();
  const { skills: userSkills, createSkill, updateSkill, deleteSkill, toggleSkill: toggleUserSkill, duplicateSkill } = useUserSkills();
  const [builtInStates, setBuiltInStates] = useState<Record<string, boolean>>(
    Object.fromEntries(BUILT_IN_SKILLS.map(s => [s.id, s.enabled]))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<UserSkill | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const allSkills = useMemo(() => {
    const builtIn: Skill[] = BUILT_IN_SKILLS.map(s => ({
      ...s,
      enabled: builtInStates[s.id] ?? s.enabled
    }));
    return [...builtIn, ...userSkills.map(s => ({ ...s, triggers: [] }))];
  }, [userSkills, builtInStates]);

  const toggleBuiltInSkill = (skillId: string) => {
    setBuiltInStates(prev => {
      const newState = { ...prev, [skillId]: !prev[skillId] };
      const skill = BUILT_IN_SKILLS.find(s => s.id === skillId);
      toast.success(newState[skillId] ? `${skill?.name} activado` : `${skill?.name} desactivado`);
      return newState;
    });
  };

  const handleToggleSkill = (skill: Skill) => {
    if (skill.builtIn) {
      toggleBuiltInSkill(skill.id);
    } else {
      toggleUserSkill(skill.id);
      toast.success(!skill.enabled ? `${skill.name} activado` : `${skill.name} desactivado`);
    }
  };

  const filteredSkills = allSkills.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || skill.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const enabledCount = allSkills.filter(s => s.enabled).length;
  const customCount = userSkills.length;

  const categoryLabels: Record<string, string> = {
    all: "Todos",
    documents: "Documentos",
    data: "Datos",
    integrations: "Integraciones",
    custom: "Personalizados"
  };

  const handleCreateSkill = () => {
    setEditingSkill(null);
    setIsBuilderOpen(true);
  };

  const handleEditSkill = (skill: UserSkill) => {
    setEditingSkill(skill);
    setIsBuilderOpen(true);
  };

  const handleSaveSkill = (skillData: Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">) => {
    if (editingSkill) {
      updateSkill(editingSkill.id, skillData);
    } else {
      createSkill(skillData);
    }
  };

  const handleDeleteSkill = (id: string) => {
    deleteSkill(id);
    setDeleteConfirmId(null);
    if (selectedSkill && !selectedSkill.builtIn && selectedSkill.id === id) {
      setSelectedSkill(null);
    }
    toast.success("Skill eliminado");
  };

  const getSkillIcon = (skill: Skill): React.ReactNode => {
    if (skill.builtIn) {
      return (skill as BuiltInSkill).icon;
    }
    return <Sparkles className="h-6 w-6 text-purple-500" />;
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              className="rounded-full"
              onClick={() => setLocation("/")}
              data-testid="button-back-skills"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Skills</h1>
                <p className="text-xs text-muted-foreground">Capacidades modulares de Sira GPT</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="gap-1">
              <Play className="h-3 w-3" />
              {enabledCount} activos
            </Badge>
            {customCount > 0 && (
              <Badge variant="outline" className="gap-1 text-purple-600 border-purple-200">
                <Sparkles className="h-3 w-3" />
                {customCount} personalizados
              </Badge>
            )}
            <Button onClick={handleCreateSkill} className="gap-2" data-testid="button-create-skill">
              <Plus className="h-4 w-4" />
              Crear Skill
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="px-6 py-4 border-b bg-muted/20">
            <div className="max-w-7xl mx-auto flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background"
                  data-testid="skills-search-input"
                />
              </div>
              <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
                <TabsList className="bg-background">
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <TabsTrigger key={key} value={key} data-testid={`tab-${key}`}>
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="max-w-7xl mx-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSkills.map((skill) => (
                  <Card
                    key={skill.id}
                    className={cn(
                      "group cursor-pointer transition-all duration-200 hover:shadow-md",
                      skill.enabled 
                        ? "border-primary/20 bg-card" 
                        : "bg-muted/30 border-transparent",
                      selectedSkill?.id === skill.id && "ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedSkill(skill)}
                    data-testid={`skill-card-${skill.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "p-3 rounded-xl transition-colors",
                          skill.enabled ? "bg-muted" : "bg-muted/50"
                        )}>
                          {getSkillIcon(skill)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="font-semibold truncate">{skill.name}</h3>
                            <div className="flex items-center gap-1">
                              {!skill.builtIn && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEditSkill(skill as UserSkill); }}>
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Editar
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateSkill(skill.id); toast.success("Skill duplicado"); }}>
                                      <Copy className="h-4 w-4 mr-2" />
                                      Duplicar
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem 
                                      className="text-red-600"
                                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(skill.id); }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Eliminar
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              <Switch
                                checked={skill.enabled}
                                onCheckedChange={() => handleToggleSkill(skill)}
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`skill-toggle-${skill.id}`}
                              />
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                            {skill.description}
                          </p>
                          <div className="flex items-center gap-2">
                            {skill.builtIn ? (
                              <Badge variant="outline" className="text-xs">Integrado</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-purple-600 border-purple-200">Personalizado</Badge>
                            )}
                            {skill.enabled && (
                              <span className="flex items-center gap-1 text-xs text-green-600">
                                <span className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
                                Activo
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {filteredSkills.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Zap className="h-16 w-16 text-muted-foreground/20 mb-4" />
                  <h3 className="text-lg font-medium mb-2">No se encontraron skills</h3>
                  <p className="text-muted-foreground mb-4">Intenta con otra búsqueda o crea uno nuevo</p>
                  <Button onClick={handleCreateSkill} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Crear Skill
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {selectedSkill && (
          <div className="w-96 border-l bg-muted/10 flex flex-col">
            <div className="p-6 border-b bg-background">
              <div className="flex items-start gap-4">
                <div className="p-4 bg-muted rounded-xl">
                  {getSkillIcon(selectedSkill)}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{selectedSkill.name}</h2>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={selectedSkill.enabled ? "default" : "secondary"}>
                      {selectedSkill.enabled ? "Activo" : "Inactivo"}
                    </Badge>
                    {selectedSkill.builtIn ? (
                      <Badge variant="outline">Integrado</Badge>
                    ) : (
                      <Badge variant="outline" className="text-purple-600">Personalizado</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Descripción
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {selectedSkill.description}
                  </p>
                </div>

                {selectedSkill.builtIn && (selectedSkill as BuiltInSkill).triggers && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Triggers
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {(selectedSkill as BuiltInSkill).triggers.map((trigger, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{trigger}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Capacidades
                  </h4>
                  <div className="space-y-2">
                    {selectedSkill.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                    {selectedSkill.features.length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin capacidades definidas</p>
                    )}
                  </div>
                </div>

                {!selectedSkill.builtIn && 'instructions' in selectedSkill && (selectedSkill as UserSkill).instructions && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Instrucciones</h4>
                    <div className="p-3 bg-muted rounded-lg text-sm font-mono max-h-48 overflow-auto whitespace-pre-wrap">
                      {(selectedSkill as UserSkill).instructions.slice(0, 500)}
                      {(selectedSkill as UserSkill).instructions.length > 500 && "..."}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="p-4 border-t bg-background space-y-2">
              <Button 
                className="w-full"
                variant={selectedSkill.enabled ? "outline" : "default"}
                onClick={() => handleToggleSkill(selectedSkill)}
              >
                {selectedSkill.enabled ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Desactivar
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Activar
                  </>
                )}
              </Button>
              {!selectedSkill.builtIn && (
                <Button 
                  className="w-full"
                  variant="outline"
                  onClick={() => handleEditSkill(selectedSkill as UserSkill)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar Skill
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <SkillBuilder
        open={isBuilderOpen}
        onOpenChange={setIsBuilderOpen}
        onSave={handleSaveSkill}
        editingSkill={editingSkill}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este Skill?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El Skill será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteConfirmId && handleDeleteSkill(deleteConfirmId)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
