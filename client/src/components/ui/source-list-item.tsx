import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "./toggle-switch";

const SOURCE_ITEM_TOKENS = {
  height: 44,
  padding: {
    x: 8,
    y: 8,
  },
  gap: 12,
  iconSize: 20,
  borderRadius: 6,
  fontSize: 14,
  lineHeight: 20,
} as const;

export interface SourceListItemProps {
  icon: React.ReactNode;
  label: string;
  truncateLabel?: boolean;
  variant: "toggle" | "connect";
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onConnect?: () => void;
  disabled?: boolean;
  loading?: boolean;
  "data-testid"?: string;
}

export function SourceListItem({
  icon,
  label,
  truncateLabel = false,
  variant,
  checked = false,
  onCheckedChange,
  onConnect,
  disabled = false,
  loading = false,
  "data-testid": testId,
}: SourceListItemProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md",
        "hover:bg-accent/50 transition-colors",
        disabled && "opacity-50 pointer-events-none",
      )}
      style={{
        minHeight: SOURCE_ITEM_TOKENS.height,
        paddingLeft: SOURCE_ITEM_TOKENS.padding.x,
        paddingRight: SOURCE_ITEM_TOKENS.padding.x,
        paddingTop: SOURCE_ITEM_TOKENS.padding.y,
        paddingBottom: SOURCE_ITEM_TOKENS.padding.y,
        gap: SOURCE_ITEM_TOKENS.gap,
        borderRadius: SOURCE_ITEM_TOKENS.borderRadius,
      }}
      data-testid={testId}
    >
      <div 
        className="flex items-center"
        style={{ gap: SOURCE_ITEM_TOKENS.gap }}
      >
        <div 
          className="flex items-center justify-center shrink-0"
          style={{ 
            width: SOURCE_ITEM_TOKENS.iconSize, 
            height: SOURCE_ITEM_TOKENS.iconSize 
          }}
        >
          {icon}
        </div>
        <span 
          className={cn(
            "font-medium text-foreground",
            truncateLabel && "truncate max-w-[100px]"
          )}
          style={{
            fontSize: SOURCE_ITEM_TOKENS.fontSize,
            lineHeight: `${SOURCE_ITEM_TOKENS.lineHeight}px`,
          }}
        >
          {label}
        </span>
      </div>

      {variant === "toggle" && onCheckedChange && (
        <ToggleSwitch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          loading={loading}
          data-testid={testId ? `${testId}-toggle` : undefined}
        />
      )}

      {variant === "connect" && (
        <button
          type="button"
          onClick={onConnect}
          disabled={disabled || loading}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          style={{
            fontSize: 12,
            lineHeight: "16px",
            padding: "4px 0",
          }}
          data-testid={testId ? `${testId}-connect` : undefined}
        >
          Conectar
        </button>
      )}
    </div>
  );
}
