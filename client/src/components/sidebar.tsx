import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  Menu, 
  Search, 
  Library, 
  Bot, 
  Plus, 
  MessageSquare, 
  MoreHorizontal,
  Settings,
  PanelLeftClose,
  ChevronDown,
  ChevronRight,
  User,
  CreditCard,
  Shield,
  LogOut,
  Trash2,
  Pencil,
  Archive,
  EyeOff,
  Eye,
  Check,
  X,
  Monitor,
  LayoutGrid,
  FolderPlus,
  Folder,
  FolderOpen
} from "lucide-react";
import { SiraLogo } from "@/components/sira-logo";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchModal } from "@/components/search-modal";
import { SettingsDialog } from "@/components/settings-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";

import { Chat } from "@/hooks/use-chats";
import { Folder as FolderType } from "@/hooks/use-chat-folders";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

interface SidebarProps {
  className?: string;
  chats: Chat[];
  hiddenChats?: Chat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat?: () => void;
  onToggle?: () => void;
  onDeleteChat?: (id: string, e: React.MouseEvent) => void;
  onEditChat?: (id: string, newTitle: string) => void;
  onArchiveChat?: (id: string, e: React.MouseEvent) => void;
  onHideChat?: (id: string, e: React.MouseEvent) => void;
  onOpenGpts?: () => void;
  onOpenApps?: () => void;
  onOpenLibrary?: () => void;
  processingChatIds?: string[];
  pendingResponseCounts?: Record<string, number>;
  onClearPendingCount?: (chatId: string) => void;
  folders?: FolderType[];
  onCreateFolder?: (name: string) => void;
  onMoveToFolder?: (chatId: string, folderId: string | null) => void;
}

function ChatSpinner() {
  return (
    <svg 
      className="h-4 w-4 flex-shrink-0" 
      fill="hsl(228, 97%, 42%)" 
      viewBox="0 0 24 24" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g>
        <circle cx="12" cy="3" r="1">
          <animate id="spinner_7Z73" begin="0;spinner_tKsu.end-0.5s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="16.50" cy="4.21" r="1">
          <animate id="spinner_Wd87" begin="spinner_7Z73.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="7.50" cy="4.21" r="1">
          <animate id="spinner_tKsu" begin="spinner_tVVl.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="19.79" cy="7.50" r="1">
          <animate id="spinner_5L0R" begin="spinner_Wd87.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="4.21" cy="7.50" r="1">
          <animate id="spinner_tVVl" begin="spinner_u6j3.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="21.00" cy="12.00" r="1">
          <animate id="spinner_JSUN" begin="spinner_5L0R.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="3.00" cy="12.00" r="1">
          <animate id="spinner_u6j3" begin="spinner_YHwI.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="19.79" cy="16.50" r="1">
          <animate id="spinner_GKXF" begin="spinner_JSUN.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="4.21" cy="16.50" r="1">
          <animate id="spinner_YHwI" begin="spinner_xGMk.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="16.50" cy="19.79" r="1">
          <animate id="spinner_pMgl" begin="spinner_GKXF.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="7.50" cy="19.79" r="1">
          <animate id="spinner_xGMk" begin="spinner_pMgl.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
        <circle cx="12" cy="21" r="1">
          <animate begin="spinner_xGMk.begin+0.1s" attributeName="r" calcMode="spline" dur="0.6s" values="1;2;1" keySplines=".27,.42,.37,.99;.53,0,.61,.73"/>
        </circle>
      </g>
    </svg>
  );
}

export function Sidebar({ 
  className, 
  chats, 
  hiddenChats = [],
  activeChatId, 
  onSelectChat, 
  onNewChat, 
  onToggle,
  onDeleteChat,
  onEditChat,
  onArchiveChat,
  onHideChat,
  onOpenGpts,
  onOpenApps,
  onOpenLibrary,
  processingChatIds = [],
  pendingResponseCounts = {},
  onClearPendingCount,
  folders = [],
  onCreateFolder,
  onMoveToFolder
}: SidebarProps) {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const handleLogout = () => {
    logout();
  };
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim() && onCreateFolder) {
      onCreateFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  };

  const allFolderChatIds = new Set(folders.flatMap(f => f.chatIds));
  const unfolderedChats = chats.filter(chat => !allFolderChatIds.has(chat.id));
  
  const handleStartEdit = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };
  
  const handleSaveEdit = (chatId: string) => {
    if (onEditChat && editTitle.trim()) {
      onEditChat(chatId, editTitle.trim());
    }
    setEditingChatId(null);
    setEditTitle("");
  };
  
  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditTitle("");
  };
  
  const getChatDateLabel = (timestamp: number) => {
    const date = new Date(timestamp);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    if (isThisWeek(date)) return "Previous 7 Days";
    if (isThisYear(date)) return format(date, "MMM d");
    return format(date, "yyyy");
  };

  // Group unfoldered chats
  const groupedChats = unfolderedChats.reduce((groups, chat) => {
    const label = getChatDateLabel(chat.timestamp);
    if (!groups[label]) groups[label] = [];
    groups[label].push(chat);
    return groups;
  }, {} as Record<string, Chat[]>);

  const renderChatItem = (chat: Chat, indented = false) => (
    <div
      key={chat.id}
      className={cn(
        "group flex w-full items-center justify-between px-2 py-2.5 rounded-xl cursor-pointer liquid-hover hover:bg-accent transition-all duration-300",
        activeChatId === chat.id && "bg-accent shadow-sm",
        chat.archived && "opacity-70",
        indented && "ml-4"
      )}
      onClick={() => !editingChatId && onSelectChat(chat.id)}
      data-testid={`chat-item-${chat.id}`}
    >
      {editingChatId === chat.id ? (
        <div className="flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="h-7 text-sm flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveEdit(chat.id);
              if (e.key === "Escape") handleCancelEdit();
            }}
            data-testid={`input-edit-chat-${chat.id}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => handleSaveEdit(chat.id)}
            data-testid={`button-save-edit-${chat.id}`}
          >
            <Check className="h-3 w-3 text-green-500" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCancelEdit}
            data-testid={`button-cancel-edit-${chat.id}`}
          >
            <X className="h-3 w-3 text-red-500" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {chat.archived && <Archive className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
            <span className="truncate text-sm font-medium">{chat.title}</span>
            {processingChatIds.includes(chat.id) && (
              <ChatSpinner />
            )}
            {!processingChatIds.includes(chat.id) && pendingResponseCounts[chat.id] > 0 && (
              <span 
                className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-medium flex-shrink-0"
                data-testid={`badge-pending-${chat.id}`}
              >
                {pendingResponseCounts[chat.id]}
              </span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
                onClick={(e) => e.stopPropagation()}
                data-testid={`button-chat-menu-${chat.id}`}
              >
                <MoreHorizontal className="h-4 w-4 text-foreground" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={(e) => handleStartEdit(chat, e as unknown as React.MouseEvent)}
                data-testid={`menu-edit-${chat.id}`}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              {folders.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid={`menu-move-folder-${chat.id}`}>
                    <Folder className="h-4 w-4 mr-2" />
                    Mover a carpeta
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {folders.map((folder) => (
                        <DropdownMenuItem
                          key={folder.id}
                          onClick={() => onMoveToFolder?.(chat.id, folder.id)}
                          data-testid={`menu-folder-${folder.id}-${chat.id}`}
                        >
                          <span 
                            className="h-3 w-3 rounded-full mr-2 flex-shrink-0" 
                            style={{ backgroundColor: folder.color }}
                          />
                          {folder.name}
                        </DropdownMenuItem>
                      ))}
                      {allFolderChatIds.has(chat.id) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onMoveToFolder?.(chat.id, null)}
                            data-testid={`menu-remove-folder-${chat.id}`}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Quitar de carpeta
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
              <DropdownMenuItem
                onClick={(e) => onArchiveChat?.(chat.id, e as unknown as React.MouseEvent)}
                data-testid={`menu-archive-${chat.id}`}
              >
                <Archive className="h-4 w-4 mr-2" />
                {chat.archived ? "Desarchivar" : "Archivar"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => onHideChat?.(chat.id, e as unknown as React.MouseEvent)}
                data-testid={`menu-hide-${chat.id}`}
              >
                <EyeOff className="h-4 w-4 mr-2" />
                Ocultar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => onDeleteChat?.(chat.id, e as unknown as React.MouseEvent)}
                className="text-red-500 focus:text-red-500"
                data-testid={`menu-delete-${chat.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );

  // Order of groups
  const groupOrder = ["Today", "Yesterday", "Previous 7 Days"];
  // Add other dynamic keys that might appear
  Object.keys(groupedChats).forEach(key => {
    if (!groupOrder.includes(key)) groupOrder.push(key);
  });
  
  return (
    <div className={cn("flex h-screen w-[260px] flex-col liquid-sidebar-light dark:liquid-sidebar text-sidebar-foreground", className)}>
      <div className="flex h-14 items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <SiraLogo size={32} />
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-none liquid-text-gradient">MICHAT</span>
            <span className="text-[10px] text-muted-foreground">AI Platform</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 liquid-button" onClick={onToggle}>
          <svg className="h-5 w-5 text-muted-foreground" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14 9L17 12L14 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      </div>

      <div className="px-2 py-2">
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium liquid-button"
          onClick={onNewChat}
          data-testid="button-new-chat"
        >
          <Plus className="h-4 w-4" />
          Nuevo Chat
        </Button>
        <Button 
          ref={searchButtonRef}
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium liquid-button"
          onClick={() => setIsSearchModalOpen(true)}
          data-testid="button-search-chats"
        >
          <Search className="h-4 w-4" />
          Buscar chats
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium liquid-button"
          onClick={onOpenLibrary}
          data-testid="button-library"
        >
          <Library className="h-4 w-4" />
          Biblioteca
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium liquid-button"
          onClick={onOpenGpts}
          data-testid="button-gpts"
        >
          <Bot className="h-4 w-4" />
          GPTs
        </Button>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 px-2 text-sm font-medium liquid-button"
          onClick={onOpenApps}
          data-testid="button-apps"
        >
          <LayoutGrid className="h-4 w-4" />
          Aplicaciones
        </Button>
      </div>

      <Separator className="mx-4 my-2 w-auto" />

      <ScrollArea className="flex-1 px-2 liquid-scroll">
        <div className="flex flex-col gap-4 pb-4">
          {folders.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="px-2 py-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">Carpetas</h3>
              </div>
              {folders.map((folder) => {
                const folderChats = chats.filter(chat => folder.chatIds.includes(chat.id));
                const isExpanded = expandedFolders.has(folder.id);
                return (
                  <Collapsible key={folder.id} open={isExpanded} onOpenChange={() => toggleFolder(folder.id)}>
                    <CollapsibleTrigger asChild>
                      <div 
                        className="flex items-center gap-2 px-2 py-2 rounded-xl cursor-pointer hover:bg-accent transition-all duration-300"
                        data-testid={`folder-${folder.id}`}
                      >
                        {isExpanded ? (
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Folder className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span 
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: folder.color }}
                        />
                        <span className="text-sm font-medium flex-1">{folder.name}</span>
                        <span className="text-xs text-muted-foreground">{folderChats.length}</span>
                        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {folderChats.map((chat) => renderChatItem(chat, true))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
              {isCreatingFolder ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Nombre de carpeta"
                    className="h-7 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    data-testid="input-new-folder-name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCreateFolder}
                    data-testid="button-save-folder"
                  >
                    <Check className="h-3 w-3 text-green-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                    data-testid="button-cancel-folder"
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCreatingFolder(true)}
                  data-testid="button-new-folder"
                >
                  <FolderPlus className="h-4 w-4" />
                  Nueva Carpeta
                </Button>
              )}
            </div>
          )}
          
          {folders.length === 0 && (
            <div className="px-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setIsCreatingFolder(true)}
                data-testid="button-new-folder"
              >
                <FolderPlus className="h-4 w-4" />
                Nueva Carpeta
              </Button>
              {isCreatingFolder && (
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Nombre de carpeta"
                    className="h-7 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    data-testid="input-new-folder-name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCreateFolder}
                    data-testid="button-save-folder"
                  >
                    <Check className="h-3 w-3 text-green-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                    data-testid="button-cancel-folder"
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {groupOrder.map((group) => {
            const groupChats = groupedChats[group];
            if (!groupChats || groupChats.length === 0) return null;

            return (
              <div key={group} className="flex flex-col gap-0.5">
                <div className="px-2 py-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground">{group}</h3>
                </div>
                {groupChats.map((chat) => renderChatItem(chat))}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Hidden Chats Section */}
      {hiddenChats.length > 0 && (
        <div className="px-2 border-t">
          <Button
            variant="ghost"
            className="w-full justify-between px-2 py-2 text-sm font-medium text-muted-foreground liquid-button"
            onClick={() => setShowHidden(!showHidden)}
            data-testid="button-toggle-hidden"
          >
            <div className="flex items-center gap-2">
              <EyeOff className="h-4 w-4" />
              <span>Ocultos ({hiddenChats.length})</span>
            </div>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showHidden && "rotate-180")} />
          </Button>
          {showHidden && (
            <div className="flex flex-col gap-0.5 pb-2">
              {hiddenChats.map((chat) => (
                <div
                  key={chat.id}
                  className="group flex w-full items-center justify-between px-2 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors opacity-70"
                  onClick={() => onSelectChat(chat.id)}
                  data-testid={`hidden-chat-item-${chat.id}`}
                >
                  <span className="truncate text-sm">{chat.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-80"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHideChat?.(chat.id, e);
                    }}
                    data-testid={`button-unhide-${chat.id}`}
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto border-t p-4">
        <div className="flex w-full items-center gap-3 rounded-lg p-2">
          <Popover open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
            <PopoverTrigger asChild>
              <button className="flex flex-1 items-center gap-3 liquid-button cursor-pointer" data-testid="button-user-menu">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                    {user?.role === "admin" ? "A" : (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col overflow-hidden text-left">
                  <span className="truncate text-sm font-medium">
                    {user?.role === "admin" ? "Admin" : (user?.firstName || user?.email?.split("@")[0] || "Usuario")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user?.email === "infosiragpt@gmail.com" ? "ENTERPRISE" : "Cuenta personal"}
                  </span>
                </div>
              </button>
            </PopoverTrigger>
          <PopoverContent className="w-auto min-w-56 p-2" align="start" side="top">
            <div className="flex flex-col">
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/profile"); }} data-testid="button-profile">
                <User className="h-4 w-4" />
                Perfil
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/billing"); }} data-testid="button-billing">
                <CreditCard className="h-4 w-4" />
                Facturación
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/workspace-settings"); }} data-testid="button-workspace-settings">
                <Monitor className="h-4 w-4" />
                Configuración del espacio de trabajo
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setIsSettingsOpen(true); }} data-testid="button-settings">
                <Settings className="h-4 w-4" />
                Configuración
              </Button>
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/privacy"); }} data-testid="button-privacy">
                <Shield className="h-4 w-4" />
                Privacidad
              </Button>
              {user?.role === "admin" && (
                <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal liquid-button" onClick={() => { setIsUserMenuOpen(false); setLocation("/admin"); }} data-testid="button-admin-panel">
                  <Settings className="h-4 w-4" />
                  Admin Panel
                </Button>
              )}
              <Separator className="my-1" />
              <Button variant="ghost" className="justify-start gap-3 text-sm h-10 font-normal text-red-500 hover:text-red-600 hover:bg-red-50 liquid-button" onClick={() => { setIsUserMenuOpen(false); handleLogout(); }} data-testid="button-logout">
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </Button>
            </div>
          </PopoverContent>
          </Popover>
          {user?.email !== "infosiragpt@gmail.com" && (
            <Button
              size="sm"
              className="rounded-full text-xs px-4 py-1 h-auto whitespace-nowrap bg-purple-600 hover:bg-purple-700 text-white border-0 flex-shrink-0"
              onClick={() => setIsUpgradeDialogOpen(true)}
              data-testid="button-upgrade-plan"
            >
              Mejorar el plan
            </Button>
          )}
        </div>
      </div>

      <SearchModal
        open={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
        chats={chats}
        onSelectChat={onSelectChat}
        triggerRef={searchButtonRef}
      />

      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />

      <UpgradePlanDialog
        open={isUpgradeDialogOpen}
        onOpenChange={setIsUpgradeDialogOpen}
      />
    </div>
  );
}
