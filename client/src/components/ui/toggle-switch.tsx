import * as React from "react";
import { cn } from "@/lib/utils";

const TOGGLE_TOKENS = {
  track: {
    width: 40,
    height: 24,
    borderRadius: 9999,
    padding: 2,
  },
  thumb: {
    size: 20,
    borderRadius: 9999,
  },
  transition: "all 150ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  "data-testid"?: string;
}

export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  loading = false,
  "data-testid": testId,
}: ToggleSwitchProps) {
  const handleClick = () => {
    if (!disabled && !loading) {
      onCheckedChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || loading}
      tabIndex={disabled ? -1 : 0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={testId}
      className={cn(
        "relative inline-flex shrink-0 box-border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        disabled || loading ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      style={{
        width: TOGGLE_TOKENS.track.width,
        height: TOGGLE_TOKENS.track.height,
        borderRadius: TOGGLE_TOKENS.track.borderRadius,
        padding: TOGGLE_TOKENS.track.padding,
        backgroundColor: checked ? "hsl(var(--primary))" : "hsl(var(--muted))",
        transition: TOGGLE_TOKENS.transition,
      }}
    >
      <span
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm",
          "ring-0",
        )}
        style={{
          width: TOGGLE_TOKENS.thumb.size,
          height: TOGGLE_TOKENS.thumb.size,
          borderRadius: TOGGLE_TOKENS.thumb.borderRadius,
          transform: checked 
            ? `translateX(${TOGGLE_TOKENS.track.width - TOGGLE_TOKENS.thumb.size - TOGGLE_TOKENS.track.padding * 2}px)` 
            : "translateX(0px)",
          transition: TOGGLE_TOKENS.transition,
          boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        }}
      />
    </button>
  );
}
