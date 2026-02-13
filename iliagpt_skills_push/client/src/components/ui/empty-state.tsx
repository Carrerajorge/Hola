import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center animate-fade-in", className)}>
      <div className="w-16 h-16 mb-4 rounded-full bg-muted flex items-center justify-center">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2" data-testid="empty-state-title">{title}</h3>
      <p className="text-muted-foreground max-w-sm mb-6" data-testid="empty-state-description">{description}</p>
      {action && (
        <Button onClick={action.onClick} data-testid="empty-state-action">
          {action.label}
        </Button>
      )}
    </div>
  );
}
