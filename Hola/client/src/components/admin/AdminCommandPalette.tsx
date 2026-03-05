/**
 * Admin Command Palette (Cmd+K / Ctrl+K)
 * Provides instant search and navigation across all admin sections,
 * quick actions, and global search through the admin API.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    LayoutDashboard,
    Users,
    MessageSquare,
    Bot,
    CreditCard,
    FileText,
    BarChart3,
    Database,
    Shield,
    FileBarChart,
    Settings,
    FileSpreadsheet,
    Terminal,
    Search,
    ArrowRight,
    Zap,
    Plus,
    RefreshCw,
    Activity,
} from "lucide-react";
import { useAdminNavigation, type AdminSection } from "@/hooks/use-admin-navigation";

interface CommandItem {
    id: string;
    label: string;
    description?: string;
    icon: React.ElementType;
    section?: AdminSection;
    context?: Record<string, any>;
    type: "navigate" | "action" | "search-result";
    keywords?: string[];
}

const SECTION_COMMANDS: CommandItem[] = [
    { id: "nav-dashboard", label: "Dashboard", description: "Vista general del sistema", icon: LayoutDashboard, section: "dashboard", type: "navigate", keywords: ["inicio", "home", "overview", "panel"] },
    { id: "nav-users", label: "Users", description: "Gestión de usuarios", icon: Users, section: "users", type: "navigate", keywords: ["usuarios", "cuentas", "accounts", "people"] },
    { id: "nav-conversations", label: "Conversations", description: "Historial de conversaciones", icon: MessageSquare, section: "conversations", type: "navigate", keywords: ["chats", "mensajes", "messages", "dialogs"] },
    { id: "nav-ai-models", label: "AI Models", description: "Modelos de inteligencia artificial", icon: Bot, section: "ai-models", type: "navigate", keywords: ["modelos", "ia", "grok", "gemini", "llm", "openai"] },
    { id: "nav-payments", label: "Payments", description: "Pagos y transacciones", icon: CreditCard, section: "payments", type: "navigate", keywords: ["pagos", "stripe", "cobros", "money", "dinero"] },
    { id: "nav-invoices", label: "Invoices", description: "Facturas y recibos", icon: FileText, section: "invoices", type: "navigate", keywords: ["facturas", "facturación", "billing", "recibos"] },
    { id: "nav-analytics", label: "Analytics", description: "Métricas y análisis", icon: BarChart3, section: "analytics", type: "navigate", keywords: ["métricas", "estadísticas", "stats", "gráficos", "charts"] },
    { id: "nav-database", label: "Database", description: "Base de datos y estado", icon: Database, section: "database", type: "navigate", keywords: ["base datos", "bd", "sql", "postgres", "tablas", "tables"] },
    { id: "nav-security", label: "Security", description: "Seguridad y políticas", icon: Shield, section: "security", type: "navigate", keywords: ["seguridad", "políticas", "policies", "audit", "logs", "alertas"] },
    { id: "nav-reports", label: "Reports", description: "Reportes y exportaciones", icon: FileBarChart, section: "reports", type: "navigate", keywords: ["reportes", "informes", "exportar", "export", "pdf"] },
    { id: "nav-settings", label: "Settings", description: "Configuración del sistema", icon: Settings, section: "settings", type: "navigate", keywords: ["configuración", "ajustes", "config", "opciones"] },
    { id: "nav-agentic", label: "Agentic Engine", description: "Motor de agentes autónomos", icon: Zap, section: "agentic", type: "navigate", keywords: ["agentes", "engine", "tools", "orquestación", "autonomo"] },
    { id: "nav-excel", label: "Excel Manager", description: "Hojas de cálculo", icon: FileSpreadsheet, section: "excel", type: "navigate", keywords: ["excel", "hojas", "spreadsheet", "xlsx", "csv"] },
    { id: "nav-terminal", label: "Terminal", description: "Consola de comandos", icon: Terminal, section: "terminal", type: "navigate", keywords: ["terminal", "consola", "shell", "bash", "cli"] },
];

const QUICK_ACTIONS: CommandItem[] = [
    { id: "action-create-user", label: "Create User", description: "Crear nuevo usuario", icon: Plus, section: "users", context: { action: "create" }, type: "action", keywords: ["crear usuario", "nuevo usuario"] },
    { id: "action-sync-models", label: "Sync AI Models", description: "Sincronizar modelos con proveedores", icon: RefreshCw, section: "ai-models", context: { action: "sync" }, type: "action", keywords: ["sincronizar", "sync", "actualizar modelos"] },
    { id: "action-generate-report", label: "Generate Report", description: "Crear nuevo reporte", icon: FileBarChart, section: "reports", context: { action: "generate" }, type: "action", keywords: ["generar reporte", "nuevo reporte"] },
    { id: "action-db-health", label: "Check DB Health", description: "Verificar estado de la base de datos", icon: Activity, section: "database", context: { tab: "health" }, type: "action", keywords: ["salud bd", "health check", "verificar"] },
    { id: "action-security-scan", label: "Security Audit", description: "Revisar alertas de seguridad", icon: Shield, section: "security", context: { tab: "alerts" }, type: "action", keywords: ["auditoría", "revisar seguridad", "alertas"] },
];

export function AdminCommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searchResults, setSearchResults] = useState<CommandItem[]>([]);
    const [searching, setSearching] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout>();
    const { navigateTo } = useAdminNavigation();

    // Keyboard shortcut (Cmd+K / Ctrl+K)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    // Reset on open
    useEffect(() => {
        if (open) {
            setQuery("");
            setSelectedIndex(0);
            setSearchResults([]);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    // Global search with debounce
    useEffect(() => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (query.length >= 3) {
            setSearching(true);
            searchTimeoutRef.current = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/admin/search/global?q=${encodeURIComponent(query)}`, { credentials: "include" });
                    if (res.ok) {
                        const data = await res.json();
                        const results: CommandItem[] = (data.results || []).slice(0, 5).map((r: any) => ({
                            id: `search-${r.type}-${r.id}`,
                            label: r.label || r.name || r.email || r.id,
                            description: `${r.type} · ${r.detail || ""}`,
                            icon: getIconForType(r.type),
                            section: getSectionForType(r.type),
                            context: { highlightId: r.id },
                            type: "search-result" as const,
                        }));
                        setSearchResults(results);
                    }
                } catch {
                    // Silently fail
                } finally {
                    setSearching(false);
                }
            }, 300);
        } else {
            setSearchResults([]);
            setSearching(false);
        }

        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        };
    }, [query]);

    const filteredCommands = [...SECTION_COMMANDS, ...QUICK_ACTIONS].filter((cmd) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
            cmd.label.toLowerCase().includes(q) ||
            cmd.description?.toLowerCase().includes(q) ||
            cmd.keywords?.some((k) => k.includes(q))
        );
    });

    const allItems = [...filteredCommands, ...searchResults];

    const executeItem = useCallback((item: CommandItem) => {
        if (item.section) {
            navigateTo(item.section, item.context);
        }
        setOpen(false);
    }, [navigateTo]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === "Enter" && allItems[selectedIndex]) {
            e.preventDefault();
            executeItem(allItems[selectedIndex]);
        }
    }, [allItems, selectedIndex, executeItem]);

    // Reset selected index on filter change
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-[540px] p-0 gap-0 overflow-hidden">
                <VisuallyHidden>
                    <DialogTitle>Admin Command Palette</DialogTitle>
                </VisuallyHidden>
                <div className="flex items-center border-b px-4 py-3">
                    <Search className="h-4 w-4 text-muted-foreground mr-3 shrink-0" />
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Buscar secciones, acciones, usuarios, pagos..."
                        className="border-0 shadow-none focus-visible:ring-0 px-0 h-auto text-base"
                        data-testid="input-command-palette"
                    />
                    <Badge variant="outline" className="ml-2 text-xs shrink-0">⌘K</Badge>
                </div>
                <div className="max-h-[360px] overflow-y-auto py-2">
                    {allItems.length === 0 && !searching && (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                            No se encontraron resultados
                        </div>
                    )}
                    {searching && (
                        <div className="text-center py-4 text-sm text-muted-foreground">
                            Buscando...
                        </div>
                    )}

                    {filteredCommands.length > 0 && (
                        <>
                            {!query && <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase">Secciones</div>}
                            {filteredCommands.filter(c => c.type === "navigate").map((item, i) => (
                                <button
                                    key={item.id}
                                    onClick={() => executeItem(item)}
                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors ${selectedIndex === i ? "bg-muted/60" : ""
                                        }`}
                                    data-testid={`cmd-${item.id}`}
                                >
                                    <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <div className="flex-1 text-left">
                                        <span className="font-medium">{item.label}</span>
                                        {item.description && (
                                            <span className="text-xs text-muted-foreground ml-2">{item.description}</span>
                                        )}
                                    </div>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                                </button>
                            ))}

                            {filteredCommands.some(c => c.type === "action") && (
                                <>
                                    {!query && <div className="px-4 py-1.5 mt-1 text-xs font-medium text-muted-foreground uppercase border-t pt-2.5">Acciones Rápidas</div>}
                                    {filteredCommands.filter(c => c.type === "action").map((item, i) => {
                                        const idx = filteredCommands.filter(c => c.type === "navigate").length + i;
                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => executeItem(item)}
                                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors ${selectedIndex === idx ? "bg-muted/60" : ""
                                                    }`}
                                                data-testid={`cmd-${item.id}`}
                                            >
                                                <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                                <div className="flex-1 text-left">
                                                    <span className="font-medium">{item.label}</span>
                                                    {item.description && (
                                                        <span className="text-xs text-muted-foreground ml-2">{item.description}</span>
                                                    )}
                                                </div>
                                                <Badge variant="secondary" className="text-[10px]">Action</Badge>
                                            </button>
                                        );
                                    })}
                                </>
                            )}
                        </>
                    )}

                    {searchResults.length > 0 && (
                        <>
                            <div className="px-4 py-1.5 mt-1 text-xs font-medium text-muted-foreground uppercase border-t pt-2.5">Resultados de Búsqueda</div>
                            {searchResults.map((item, i) => {
                                const idx = filteredCommands.length + i;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => executeItem(item)}
                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors ${selectedIndex === idx ? "bg-muted/60" : ""
                                            }`}
                                        data-testid={`cmd-${item.id}`}
                                    >
                                        <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <div className="flex-1 text-left">
                                            <span className="font-medium">{item.label}</span>
                                            {item.description && (
                                                <span className="text-xs text-muted-foreground ml-2">{item.description}</span>
                                            )}
                                        </div>
                                        <Badge variant="outline" className="text-[10px]">Found</Badge>
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
                <div className="border-t px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>↑↓ navegar</span>
                    <span>↵ seleccionar</span>
                    <span>esc cerrar</span>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function getIconForType(type: string) {
    const map: Record<string, React.ElementType> = {
        user: Users,
        payment: CreditCard,
        invoice: FileText,
        model: Bot,
        conversation: MessageSquare,
        report: FileBarChart,
        security: Shield,
    };
    return map[type] || Search;
}

function getSectionForType(type: string): AdminSection {
    const map: Record<string, AdminSection> = {
        user: "users",
        payment: "payments",
        invoice: "invoices",
        model: "ai-models",
        conversation: "conversations",
        report: "reports",
        security: "security",
    };
    return map[type] || "dashboard";
}
