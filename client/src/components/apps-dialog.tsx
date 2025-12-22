import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface App {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: "featured" | "productivity" | "lifestyle";
  verified?: boolean;
}

const apps: App[] = [
  {
    id: "photoshop",
    name: "Adobe Photoshop",
    description: "Edit, stylize, refine images",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#001E36] flex items-center justify-center">
        <span className="text-[#31A8FF] font-bold text-lg">Ps</span>
      </div>
    ),
    category: "featured",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Add structured data to ChatGPT",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FCB400] via-[#18BFFF] to-[#F82B60] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
    ),
    category: "featured",
  },
  {
    id: "apple-music",
    name: "Apple Music",
    description: "Build playlists and find music",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-gradient-to-b from-[#FA233B] to-[#FB5C74] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
    ),
    category: "featured",
  },
  {
    id: "booking",
    name: "Booking.com",
    description: "Find hotels, homes and more",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#003580] flex items-center justify-center">
        <span className="text-white font-bold text-lg">B.</span>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "canva",
    name: "Canva",
    description: "Search, create, edit designs",
    icon: (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00C4CC] via-[#7D2AE8] to-[#FF7EB3] flex items-center justify-center">
        <span className="text-white font-bold text-lg">C</span>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "figma",
    name: "Figma",
    description: "Make diagrams, slides, assets",
    icon: (
      <div className="w-10 h-10 flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 38 57" fill="none">
          <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
          <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
          <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
          <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
          <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
        </svg>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "lovable",
    name: "Lovable",
    description: "Build apps and websites",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FF6B6B] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "opentable",
    name: "OpenTable",
    description: "Find restaurant reservations",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#DA3743] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "replit",
    name: "Replit",
    description: "Turn your ideas into real apps",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#F26207] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm4 2v8h2V8H6zm4 0v8h4a2 2 0 002-2v-4a2 2 0 00-2-2h-4zm2 2h2v4h-2v-4z" />
        </svg>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "tripadvisor",
    name: "Tripadvisor",
    description: "Book top-rated hotels",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#34E0A1] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="8" cy="12" r="3" />
          <circle cx="16" cy="12" r="3" />
        </svg>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "google-forms",
    name: "Google Forms",
    description: "Create and manage forms",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#673AB7] flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="9" r="1.5" fill="white"/>
          <rect x="12" y="8" width="5" height="2" rx="1" fill="white"/>
          <circle cx="9" cy="13" r="1.5" fill="white"/>
          <rect x="12" y="12" width="5" height="2" rx="1" fill="white"/>
          <circle cx="9" cy="17" r="1.5" fill="white"/>
          <rect x="12" y="16" width="5" height="2" rx="1" fill="white"/>
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Access your files and folders",
    icon: (
      <div className="w-10 h-10 flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 87.3 78" fill="none">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA"/>
          <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 52.35c-.8 1.4-1.2 2.95-1.2 4.5h27.5l16.15-31.85z" fill="#00AC47"/>
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L73.55 76.8z" fill="#EA4335"/>
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#00832D"/>
          <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h41.8c1.6 0 3.15-.45 4.5-1.2L59.85 53z" fill="#2684FC"/>
          <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.85 53h27.45c0-1.55-.4-3.1-1.2-4.5l-12.7-22z" fill="#FFBA00"/>
        </svg>
      </div>
    ),
    category: "productivity",
  },
];

interface AppsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenGoogleForms?: () => void;
}

export function AppsDialog({ open, onOpenChange, onOpenGoogleForms }: AppsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("featured");

  const filteredApps = apps.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === "featured") return matchesSearch;
    if (activeTab === "productivity") return matchesSearch && app.category === "productivity";
    if (activeTab === "lifestyle") return matchesSearch && app.category === "lifestyle";
    return matchesSearch;
  });

  const handleAppClick = (appId: string) => {
    if (appId === "google-forms" && onOpenGoogleForms) {
      onOpenChange(false);
      onOpenGoogleForms();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden p-0" data-testid="apps-dialog">
        <div className="flex flex-col h-full">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-2xl font-semibold">Aplicaciones</DialogTitle>
                <Badge variant="secondary" className="text-xs font-medium">BETA</Badge>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar aplicaciones"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                  data-testid="input-search-apps"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Chatea con tus aplicaciones favoritas en Sira GPT
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="relative rounded-2xl overflow-hidden mb-6 bg-gradient-to-r from-sky-100 via-sky-50 to-white dark:from-sky-900/30 dark:via-sky-800/20 dark:to-background">
              <div className="flex items-center p-6">
                <div className="flex-1">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-4">
                    <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Haz prospección con Clay</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Encuentra contactos y personaliza la comunicación
                  </p>
                  <Button size="sm" className="rounded-full px-6" data-testid="button-view-clay">
                    Ver
                  </Button>
                </div>
                <div className="hidden md:block w-80 h-40 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 transform rotate-3">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-medium text-blue-600">@Clay</span>
                    <span className="text-xs text-muted-foreground">find GTM Leaders at Conclusive AI</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
                        <span className="text-xs">🎯</span>
                      </div>
                      <span className="text-sm font-medium">Conclusive AI</span>
                    </div>
                    <Button size="sm" variant="default" className="h-6 text-xs px-2 bg-green-500 hover:bg-green-600">
                      Open <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100" />
                      <div>
                        <p className="text-xs font-medium">Daniel Cheung</p>
                        <p className="text-[10px] text-muted-foreground">Head of GTM Engineering</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
              <TabsList className="bg-transparent p-0 h-auto gap-2">
                <TabsTrigger 
                  value="featured" 
                  className={cn(
                    "px-4 py-2 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background",
                    "data-[state=inactive]:bg-muted data-[state=inactive]:text-foreground"
                  )}
                  data-testid="tab-featured"
                >
                  Destacado
                </TabsTrigger>
                <TabsTrigger 
                  value="productivity"
                  className={cn(
                    "px-4 py-2 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background",
                    "data-[state=inactive]:bg-muted data-[state=inactive]:text-foreground"
                  )}
                  data-testid="tab-productivity"
                >
                  Productividad
                </TabsTrigger>
                <TabsTrigger 
                  value="lifestyle"
                  className={cn(
                    "px-4 py-2 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background",
                    "data-[state=inactive]:bg-muted data-[state=inactive]:text-foreground"
                  )}
                  data-testid="tab-lifestyle"
                >
                  Estilo de vida
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filteredApps.map((app) => (
                <button
                  key={app.id}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-accent transition-colors text-left group"
                  onClick={() => handleAppClick(app.id)}
                  data-testid={`app-item-${app.id}`}
                >
                  <div className="flex-shrink-0">{app.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{app.name}</span>
                      {app.verified && (
                        <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                        </svg>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{app.description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>

            {filteredApps.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No se encontraron aplicaciones</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
