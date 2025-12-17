import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
}

const defaultCategories = [
  { slug: "destacados", name: "Principales selecciones", icon: Sparkles },
  { slug: "imagen", name: "DALL-E", icon: PenTool },
  { slug: "escritura", name: "Escritura", icon: PenTool },
  { slug: "productividad", name: "Productividad", icon: Briefcase },
  { slug: "investigacion", name: "Investigación y análisis", icon: BookOpen },
  { slug: "programacion", name: "Programación", icon: Code },
];

export function GptExplorer({ open, onOpenChange, onSelectGpt, onCreateGpt }: GptExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("destacados");
  const [gpts, setGpts] = useState<Gpt[]>([]);
  const [myGpts, setMyGpts] = useState<Gpt[]>([]);
  const [categories, setCategories] = useState<GptCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"explore" | "my-gpts">("explore");

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
        fetch("/api/gpts")
      ]);
      const publicData = await publicRes.json();
      const myData = await myRes.json();
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
    
    if (searchQuery.trim()) {
      filtered = filtered.filter(gpt => 
        gpt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        gpt.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [gpts, myGpts, searchQuery, view]);

  const popularGpts = useMemo(() => {
    return [...gpts].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 6);
  }, [gpts]);

  const handleSelectGpt = (gpt: Gpt) => {
    onSelectGpt(gpt);
    onOpenChange(false);
  };

  const handleCreateNew = () => {
    onCreateGpt();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[99vw] max-w-[99vw] h-[99vh] p-0 gap-0 overflow-hidden" data-testid="gpt-explorer-dialog">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-6 py-4 border-b">
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
              className="gap-2 mr-[120px]"
              data-testid="button-create-gpt"
            >
              <Plus className="h-4 w-4" />
              Crear
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-6">
              <div className="text-center mb-8">
                <h1 className="text-4xl font-bold mb-4">GPT</h1>
                <p className="text-muted-foreground max-w-xl mx-auto">
                  Descubre y crea versiones personalizadas de ChatGPT que combinen instrucciones, conocimientos adicionales y cualquier combinación de habilidades.
                </p>
              </div>

              <div className="relative max-w-xl mx-auto mb-8">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar GPT"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-12 rounded-full bg-muted/50"
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
                        className="whitespace-nowrap"
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
                      <h2 className="text-lg font-semibold mb-2">Popular en tu espacio de trabajo</h2>
                      <p className="text-sm text-muted-foreground mb-4">Los GPTs más populares en tu espacio de trabajo</p>
                      
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
                        ) : popularGpts.length > 0 ? (
                          popularGpts.map((gpt, index) => (
                            <GptCard 
                              key={gpt.id}
                              gpt={gpt}
                              index={index + 1}
                              onClick={() => handleSelectGpt(gpt)}
                            />
                          ))
                        ) : (
                          <div className="col-span-2 text-center py-8 text-muted-foreground">
                            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No hay GPTs disponibles todavía.</p>
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
                        <div key={i} className="flex items-start gap-4 p-4 rounded-lg bg-muted/30 animate-pulse">
                          <div className="w-12 h-12 rounded-lg bg-muted"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-muted rounded w-3/4"></div>
                            <div className="h-3 bg-muted rounded w-full"></div>
                          </div>
                        </div>
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
                  <Button variant="outline" className="w-full max-w-xs" data-testid="button-view-more">
                    Ver más
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface GptCardProps {
  gpt: Gpt;
  index?: number;
  onClick: () => void;
  showEdit?: boolean;
}

function GptCard({ gpt, index, onClick, showEdit }: GptCardProps) {
  return (
    <div 
      className="flex items-start gap-4 p-4 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={onClick}
      data-testid={`gpt-card-${gpt.id}`}
    >
      {index && (
        <span className="text-2xl font-bold text-muted-foreground/50 w-6 flex-shrink-0">
          {index}
        </span>
      )}
      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
        {gpt.avatar ? (
          <img src={gpt.avatar} alt={gpt.name} className="w-full h-full rounded-lg object-cover" />
        ) : (
          <Bot className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium truncate">{gpt.name}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{gpt.description || "Sin descripción"}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>Por {gpt.creatorId || "Usuario"}</span>
          {gpt.usageCount && gpt.usageCount > 0 && (
            <>
              <span>·</span>
              <span><LinkIcon className="inline h-3 w-3 mr-1" />{gpt.usageCount}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
