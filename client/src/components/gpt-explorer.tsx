import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { SkeletonCard } from "@/components/skeletons";
import { Dialog, FullScreenDialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Plus,
  Bot,
  Sparkles,
  Code,
  PenTool,
  BarChart3,
  BookOpen,
  Briefcase,
  ArrowRight,
  Link as LinkIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Gpt {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatar: string | null;
  categoryId: string | null;
  creatorId: string | null;
  visibility: string | null;
  systemPrompt: string;
  temperature: string | null;
  topP: string | null;
  maxTokens: number | null;
  welcomeMessage: string | null;
  capabilities: any;
  conversationStarters: string[] | null;
  usageCount: number | null;
  version: number | null;
  isPublished: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GptCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sortOrder: number | null;
}

interface GptExplorerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectGpt: (gpt: Gpt) => void;
  onCreateGpt: () => void;
  onEditGpt?: (gpt: Gpt) => void;
}

const defaultCategories = [
  { slug: "destacados", name: "Principales selecciones", icon: Sparkles },
  { slug: "imagen", name: "DALL-E", icon: PenTool },
  { slug: "escritura", name: "Escritura", icon: PenTool },
  { slug: "productividad", name: "Productividad", icon: Briefcase },
  { slug: "investigacion", name: "Investigación y análisis", icon: BookOpen },
  { slug: "programacion", name: "Programación", icon: Code },
];

export function GptExplorer({ open, onOpenChange, onSelectGpt, onCreateGpt, onEditGpt }: GptExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("destacados");
  const [gpts, setGpts] = useState<Gpt[]>([]);
  const [myGpts, setMyGpts] = useState<Gpt[]>([]);
  const [categories, setCategories] = useState<GptCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"explore" | "my-gpts">("explore");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (open) {
      fetchGpts();
      fetchCategories();
    }
  }, [open]);

  const fetchGpts = async () => {
    try {
      setLoading(true);
      const [publicRes, myRes] = await Promise.all([
        fetch("/api/gpts?visibility=public"),
        fetch("/api/gpts/my")
      ]);
      const [publicData, myData] = await Promise.all([
        publicRes.json(),
        myRes.json()
      ]);
      setGpts(Array.isArray(publicData) ? publicData : []);
      setMyGpts(Array.isArray(myData) ? myData : []);
    } catch (error) {
      console.error("Error fetching GPTs:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/gpt-categories");
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const filteredGpts = useMemo(() => {
    let filtered = view === "my-gpts" ? myGpts : gpts;

    if (deferredSearchQuery.trim()) {
      filtered = filtered.filter(gpt =>
        gpt.name.toLowerCase().includes(deferredSearchQuery.toLowerCase()) ||
        gpt.description?.toLowerCase().includes(deferredSearchQuery.toLowerCase())
      );
    }

    return filtered;
  }, [deferredSearchQuery, gpts, myGpts, view]);

  const displayGpts = useMemo(() => {
    if (activeTab === "destacados") {
      return myGpts.slice(0, 6);
    }
    return [...gpts].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 6);
  }, [gpts, myGpts, activeTab]);

  const handleSelectGpt = (gpt: Gpt) => {
    onSelectGpt(gpt);
    onOpenChange(false);
  };

  const handleCreateNew = () => {
    onCreateGpt();
    onOpenChange(false);
  };

  const handleEditGpt = (gpt: Gpt) => {
    if (onEditGpt) {
      onEditGpt(gpt);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FullScreenDialogContent
        className="liquid-shell gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0"
        data-testid="gpt-explorer-dialog"
      >
        <VisuallyHidden>
          <DialogTitle>Explorar GPTs</DialogTitle>
          <DialogDescription>Descubre y crea versiones personalizadas de ChatGPT</DialogDescription>
        </VisuallyHidden>
        <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(165,160,255,0.16),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.88))] dark:bg-[radial-gradient(circle_at_top_left,rgba(165,160,255,0.18),transparent_30%),linear-gradient(180deg,rgba(12,12,16,0.98),rgba(10,10,14,0.92))]">
          <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-4 dark:border-white/10">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  "text-sm font-medium cursor-pointer transition-colors",
                  view === "explore" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setView("explore")}
                data-testid="tab-explore-gpts"
              >
                Explorar GPT
              </span>
              <span
                className={cn(
                  "text-sm font-medium cursor-pointer transition-colors",
                  view === "my-gpts" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setView("my-gpts")}
                data-testid="tab-my-gpts"
              >
                Mis GPT
              </span>
            </div>
            <Button
              onClick={handleCreateNew}
              className="liquid-chip btn-premium mr-[44px] gap-2"
              data-testid="button-create-gpt"
            >
              <Plus className="h-4 w-4" />
              Crear
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto w-full max-w-[1680px] p-6 md:p-8">
              <div className="mb-8 grid gap-5 rounded-[28px] border border-white/50 bg-white/72 p-6 shadow-[0_30px_80px_rgba(90,88,170,0.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 dark:shadow-[0_24px_80px_rgba(8,8,20,0.35)] md:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#A5A0FF]/25 bg-[#A5A0FF]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#5b56d6] dark:border-[#A5A0FF]/20 dark:bg-[#A5A0FF]/12 dark:text-[#c9c6ff]">
                    <Sparkles className="h-3.5 w-3.5" />
                    GPT Workspace
                  </div>
                  <div className="space-y-3">
                    <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">Descubre, combina y publica GPTs de alto nivel</h1>
                    <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-white/65">
                      Explora asistentes curados para investigación, productividad, programación y automatización.
                      Cada GPT puede combinar instrucciones, contexto propio y skills especializadas sin salir de tu flujo actual.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                  <div className="rounded-[22px] border border-white/60 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/6">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#A5A0FF]/12 text-[#5b56d6] dark:bg-[#A5A0FF]/14 dark:text-[#cbc7ff]">
                      <Bot className="h-5 w-5" />
                    </div>
                    <p className="text-2xl font-semibold text-slate-950 dark:text-white">{myGpts.length}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-white/45">Mis GPTs</p>
                  </div>
                  <div className="rounded-[22px] border border-white/60 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/6">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:bg-emerald-500/14 dark:text-emerald-300">
                      <BarChart3 className="h-5 w-5" />
                    </div>
                    <p className="text-2xl font-semibold text-slate-950 dark:text-white">{gpts.length}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-white/45">Explorar</p>
                  </div>
                  <div className="rounded-[22px] border border-white/60 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/6">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-600 dark:bg-sky-500/14 dark:text-sky-300">
                      <LinkIcon className="h-5 w-5" />
                    </div>
                    <p className="text-2xl font-semibold text-slate-950 dark:text-white">{categories.length || defaultCategories.length}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-white/45">Categorías</p>
                  </div>
                </div>
              </div>

              <div className="relative max-w-xl mx-auto mb-8">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar GPT"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="liquid-input h-12 rounded-full border-white/40 pl-10"
                  data-testid="input-search-gpts"
                />
              </div>

              {view === "explore" ? (
                <>
                  <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
                    {defaultCategories.map((cat) => (
                      <Button
                        key={cat.slug}
                        variant={activeTab === cat.slug ? "secondary" : "ghost"}
                        className={cn("whitespace-nowrap rounded-full", activeTab === cat.slug && "liquid-chip")}
                        onClick={() => setActiveTab(cat.slug)}
                        data-testid={`tab-category-${cat.slug}`}
                      >
                        {cat.name}
                      </Button>
                    ))}
                    <Button variant="ghost" className="whitespace-nowrap" data-testid="button-more-categories">
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>

                  {!searchQuery && (
                    <div className="mb-8">
                      <h2 className="text-lg font-semibold mb-2">
                        {activeTab === "destacados" ? "Tus GPTs creados" : "Popular en tu espacio de trabajo"}
                      </h2>
                      <p className="text-sm text-muted-foreground mb-4">
                        {activeTab === "destacados"
                          ? "Los GPTs que has creado en tu cuenta"
                          : "Los GPTs más populares en tu espacio de trabajo"}
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {loading ? (
                          Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex items-start gap-4 p-4 rounded-lg bg-muted/30 animate-pulse">
                              <div className="w-12 h-12 rounded-lg bg-muted"></div>
                              <div className="flex-1 space-y-2">
                                <div className="h-4 bg-muted rounded w-3/4"></div>
                                <div className="h-3 bg-muted rounded w-full"></div>
                              </div>
                            </div>
                          ))
                        ) : displayGpts.length > 0 ? (
                          displayGpts.map((gpt, index) => (
                            <GptCard
                              key={gpt.id}
                              gpt={gpt}
                              index={index + 1}
                              onClick={() => handleSelectGpt(gpt)}
                              showEdit={activeTab === "destacados"}
                              onEdit={handleEditGpt}
                            />
                          ))
                        ) : (
                          <div className="col-span-2 text-center py-8 text-muted-foreground">
                            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>{activeTab === "destacados" ? "No has creado ningún GPT todavía." : "No hay GPTs disponibles todavía."}</p>
                            <Button variant="link" onClick={handleCreateNew} className="mt-2">
                              Crea tu primer GPT
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {searchQuery && (
                    <div className="space-y-4">
                      {filteredGpts.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {filteredGpts.map((gpt, index) => (
                            <GptCard
                              key={gpt.id}
                              gpt={gpt}
                              index={index + 1}
                              onClick={() => handleSelectGpt(gpt)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                          <p>No se encontraron GPTs para "{searchQuery}"</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Mis GPTs</h2>
                    <Button variant="outline" size="sm" onClick={handleCreateNew}>
                      <Plus className="h-4 w-4 mr-2" />
                      Crear nuevo
                    </Button>
                  </div>

                  {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={i} />
                      ))}
                    </div>
                  ) : filteredGpts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredGpts.map((gpt, index) => (
                        <GptCard
                          key={gpt.id}
                          gpt={gpt}
                          index={index + 1}
                          onClick={() => handleSelectGpt(gpt)}
                          showEdit
                          onEdit={handleEditGpt}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p className="mb-4">No has creado ningún GPT todavía.</p>
                      <Button onClick={handleCreateNew}>
                        <Plus className="h-4 w-4 mr-2" />
                        Crear mi primer GPT
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {!searchQuery && view === "explore" && (
                <div className="mt-8 text-center">
                  <Button variant="outline" className="liquid-chip w-full max-w-xs" data-testid="button-view-more">
                    Ver más
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </FullScreenDialogContent>
    </Dialog>
  );
}

interface GptCardProps {
  gpt: Gpt;
  index?: number;
  onClick: () => void;
  showEdit?: boolean;
  onEdit?: (gpt: Gpt) => void;
}

function GptCard({ gpt, index, onClick, showEdit, onEdit }: GptCardProps) {
  const visibilityLabels: Record<string, string> = {
    'private': 'Privado',
    'team': 'Equipo',
    'public': 'Público'
  };

  // Determine if this is a popular/featured GPT
  const isPopular = (gpt.usageCount || 0) > 50;
  const isRecent = new Date(gpt.updatedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;

  return (
    <div
      className={cn(
        "liquid-card group relative flex items-start gap-4 rounded-[24px] p-4 cursor-pointer transition-all duration-300 border border-white/45 bg-white/72 shadow-sm hover:-translate-y-1 hover:shadow-[0_24px_40px_rgba(96,90,190,0.12)] dark:border-white/8 dark:bg-white/5",
        isPopular
          ? "border-primary/20"
          : "hover:bg-white/80 dark:hover:bg-slate-900/70",
        isRecent && !isPopular && "ring-1 ring-green-500/20"
      )}
      onClick={onClick}
      data-testid={`gpt-card-${gpt.id}`}
    >
      {/* Popular badge */}
      {isPopular && (
        <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-gradient-to-r from-primary to-purple-500 text-white text-[9px] font-bold shadow-sm">
          🔥 Popular
        </div>
      )}

      {/* Recent badge */}
      {isRecent && !isPopular && (
        <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-green-500 text-white text-[9px] font-bold shadow-sm">
          ✨ Nuevo
        </div>
      )}

      {index && (
        <span className={cn(
          "text-2xl font-bold w-6 flex-shrink-0",
          isPopular ? "text-primary/70" : "text-muted-foreground/50"
        )}>
          {index}
        </span>
      )}
      <div className={cn(
        "w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0",
        isPopular ? "bg-gradient-to-br from-primary/20 to-purple-500/20 ring-2 ring-primary/30" : "bg-muted"
      )}>
        {gpt.avatar ? (
          <img src={gpt.avatar} alt={gpt.name} className="w-full h-full rounded-lg object-cover" />
        ) : (
          <Bot className={cn("h-6 w-6", isPopular ? "text-primary" : "text-muted-foreground")} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className={cn(
            "font-medium truncate",
            isPopular && "text-primary"
          )}>{gpt.name}</h3>
          {gpt.visibility && gpt.visibility !== 'public' && (
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full",
              gpt.visibility === 'private' ? "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300" : "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300"
            )}>
              {visibilityLabels[gpt.visibility] || gpt.visibility}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2">{gpt.description || "Sin descripción"}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>Por ti</span>
          {gpt.usageCount && gpt.usageCount > 0 && (
            <>
              <span>·</span>
              <span className={cn(
                "flex items-center gap-1",
                isPopular && "text-primary font-medium"
              )}>
                <LinkIcon className="inline h-3 w-3" />
                {gpt.usageCount.toLocaleString()} usos
              </span>
            </>
          )}
        </div>
      </div>
      {showEdit && onEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(gpt);
          }}
          data-testid={`button-edit-gpt-${gpt.id}`}
        >
          Editar
        </Button>
      )}
    </div>
  );
}
