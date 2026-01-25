import React, { memo, type ReactNode } from "react";
import { LucideIcon, MessageSquare, FolderOpen, Search, FileText, Image as ImageIcon, Inbox, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EmptyStateVariant = 'messages' | 'chats' | 'search' | 'documents' | 'images' | 'folder' | 'default';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: { container: 'py-6 px-4', icon: 'w-6 h-6', iconContainer: 'w-12 h-12', title: 'text-sm', description: 'text-xs' },
  md: { container: 'py-12 px-4', icon: 'w-8 h-8', iconContainer: 'w-16 h-16', title: 'text-lg', description: 'text-sm' },
  lg: { container: 'py-16 px-6', icon: 'w-10 h-10', iconContainer: 'w-20 h-20', title: 'text-xl', description: 'text-base' },
};

export const EmptyState = memo(function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  size = 'md'
}: EmptyStateProps) {
  const sizes = sizeClasses[size];

  return (
    <div
      className={cn("flex flex-col items-center justify-center text-center animate-fade-in", sizes.container, className)}
      role="status"
      aria-label={title}
    >
      <div className={cn("mb-4 rounded-full bg-muted flex items-center justify-center", sizes.iconContainer)}>
        <Icon className={cn("text-muted-foreground", sizes.icon)} aria-hidden="true" />
      </div>
      <h3 className={cn("font-semibold mb-2", sizes.title)} data-testid="empty-state-title">
        {title}
      </h3>
      <p className={cn("text-muted-foreground max-w-sm mb-6", sizes.description)} data-testid="empty-state-description">
        {description}
      </p>
      {action && (
        <Button onClick={action.onClick} size={size === 'sm' ? 'sm' : 'default'} data-testid="empty-state-action">
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          {action.label}
        </Button>
      )}
    </div>
  );
});

/**
 * Chat list empty state with call-to-action
 */
export const ChatListEmptyState = memo(function ChatListEmptyState({
  onNewChat,
  className,
}: {
  onNewChat?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Sparkles}
      title="Bienvenido a IliaGPT"
      description="Inicia una nueva conversación para explorar las posibilidades de la IA"
      action={onNewChat ? { label: 'Nuevo chat', onClick: onNewChat } : undefined}
      className={className}
    />
  );
});

/**
 * Message list empty state
 */
export const MessageListEmptyState = memo(function MessageListEmptyState({
  className,
}: {
  className?: string;
}) {
  return (
    <EmptyState
      icon={MessageSquare}
      title="¿En qué puedo ayudarte?"
      description="Escribe un mensaje para comenzar la conversación"
      size="lg"
      className={className}
    />
  );
});

/**
 * Search results empty state
 */
export const SearchEmptyState = memo(function SearchEmptyState({
  query,
  className,
}: {
  query?: string;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Search}
      title="Sin resultados"
      description={query ? `No se encontraron resultados para "${query}"` : 'Intenta con otros términos de búsqueda'}
      size="sm"
      className={className}
    />
  );
});

/**
 * Folder empty state
 */
export const FolderEmptyState = memo(function FolderEmptyState({
  folderName,
  className,
}: {
  folderName?: string;
  className?: string;
}) {
  return (
    <EmptyState
      icon={FolderOpen}
      title={folderName ? `${folderName} está vacía` : 'Carpeta vacía'}
      description="Mueve chats a esta carpeta para organizarlos"
      size="sm"
      className={className}
    />
  );
});

export default EmptyState;
