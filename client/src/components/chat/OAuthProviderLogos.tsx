import * as React from "react";
import { cn } from "@/lib/utils";

type LogoProps = React.SVGProps<SVGSVGElement>;

export function GeminiLogoIcon({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      <defs>
        <linearGradient id="gemini-logo-gradient" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A73E8" />
          <stop offset="0.45" stopColor="#8E6CF8" />
          <stop offset="1" stopColor="#34A853" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gemini-logo-gradient)"
        d="M12 2.5c.46 3.63 1.24 5.96 2.42 7.08 1.11 1.05 3.45 1.84 7.08 2.42-3.63.58-5.97 1.37-7.08 2.42-1.18 1.12-1.96 3.45-2.42 7.08-.46-3.63-1.24-5.96-2.42-7.08-1.11-1.05-3.45-1.84-7.08-2.42 3.63-.58 5.97-1.37 7.08-2.42C10.76 8.46 11.54 6.13 12 2.5Z"
      />
    </svg>
  );
}

export function ChatGptLogoIcon({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      <g fill="currentColor">
        <path d="M12 2.75a3.25 3.25 0 0 1 2.83 1.65l.2.35 1.46-.84a3.25 3.25 0 0 1 4.6 4.28l-.18.36-.83 1.43.82 1.43a3.25 3.25 0 0 1-2.64 4.86l-.41.02h-1.65v1.69a3.25 3.25 0 0 1-5.43 2.42l-.31-.28-1.22-1.16-1.45.83a3.25 3.25 0 0 1-4.61-4.26l.18-.36.83-1.44-.83-1.43a3.25 3.25 0 0 1 2.64-4.86l.42-.02h1.64V6.02A3.25 3.25 0 0 1 12 2.75Zm0 1.8a1.45 1.45 0 0 0-1.44 1.27l-.02.2v2.72H7.86a1.45 1.45 0 0 0-1.34 2l.09.18 1.37 2.34-1.37 2.35a1.45 1.45 0 0 0 1.77 2.06l.18-.09 2.35-1.35 2.02 1.93a1.45 1.45 0 0 0 2.43-.88l.02-.2v-2.72h2.69a1.45 1.45 0 0 0 1.34-2l-.09-.18-1.37-2.35 1.37-2.34a1.45 1.45 0 0 0-1.77-2.06l-.18.09-2.35 1.35-2.02-1.93a1.45 1.45 0 0 0-.82-.38L12 4.55Z" />
        <path d="M14.13 7.12a.9.9 0 0 1 1.23.32.9.9 0 0 1-.33 1.23l-4.17 2.38 4.18 2.39a.9.9 0 0 1-.9 1.56l-5.58-3.2a.9.9 0 0 1 0-1.57l5.57-3.2Zm-4.26-1.67a.9.9 0 0 1 .33 1.23L6.03 9.06a.9.9 0 1 1-.9-1.55l4.17-2.39a.9.9 0 0 1 .57-.12Zm8.96 8.1a.9.9 0 0 1 .33 1.24l-4.17 7.2a.9.9 0 1 1-1.56-.9l4.17-7.2a.9.9 0 0 1 1.23-.34Z" opacity=".85" />
      </g>
    </svg>
  );
}
