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
        <linearGradient
          id="gemini-logo-gradient"
          x1="4"
          y1="3"
          x2="20"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
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
      <path
        d="M22.28 9.37a5.99 5.99 0 0 0-.52-4.93 6.07 6.07 0 0 0-6.55-2.91A5.99 5.99 0 0 0 10.69.18a6.07 6.07 0 0 0-5.8 4.21 5.99 5.99 0 0 0-4.01 2.9 6.07 6.07 0 0 0 .74 7.12 5.99 5.99 0 0 0 .52 4.93 6.07 6.07 0 0 0 6.55 2.91 5.99 5.99 0 0 0 4.52 1.35 6.07 6.07 0 0 0 5.8-4.21 5.99 5.99 0 0 0 4.01-2.9 6.07 6.07 0 0 0-.74-7.12Z"
        fill="#10a37f"
      />
      <path
        d="M11.14 18.86a4.5 4.5 0 0 1-2.88-1.04l3.86-2.23V10l-3.45 1.99V8.01l3.45-1.99a4.52 4.52 0 0 1 2.88 4.02v3.97l-3.45 1.99a4.48 4.48 0 0 1-.41 2.86Z"
        fill="white"
        opacity="0.9"
      />
    </svg>
  );
}

export function OpenAILogoIcon({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      <path
        d="M22.28 9.37a5.99 5.99 0 0 0-.52-4.93 6.07 6.07 0 0 0-6.55-2.91A5.99 5.99 0 0 0 10.69.18a6.07 6.07 0 0 0-5.8 4.21 5.99 5.99 0 0 0-4.01 2.9 6.07 6.07 0 0 0 .74 7.12 5.99 5.99 0 0 0 .52 4.93 6.07 6.07 0 0 0 6.55 2.91 5.99 5.99 0 0 0 4.52 1.35 6.07 6.07 0 0 0 5.8-4.21 5.99 5.99 0 0 0 4.01-2.9 6.07 6.07 0 0 0-.74-7.12Zm-8.06 13.8a4.5 4.5 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.67v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.52 4.52 0 0 1-4.49 4.48Zm-9.67-4.12a4.48 4.48 0 0 1-.54-3.03l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.83-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.52 4.52 0 0 1-6.13-1.62ZM3.24 7.83a4.49 4.49 0 0 1 2.34-1.97V11.6a.77.77 0 0 0 .39.68l5.83 3.37-2.02 1.16a.07.07 0 0 1-.07 0L4.88 14a4.52 4.52 0 0 1-1.64-6.17Zm16.6 3.87-5.84-3.37L16.02 7.17a.07.07 0 0 1 .07 0l4.83 2.79a4.51 4.51 0 0 1-.7 8.14V12.37a.78.78 0 0 0-.38-.67Zm2.01-3.04-.14-.08-4.78-2.76a.77.77 0 0 0-.78 0l-5.83 3.37V6.86a.07.07 0 0 1 .03-.06l4.83-2.79a4.52 4.52 0 0 1 6.67 4.65ZM8.02 13.15 6 11.98a.07.07 0 0 1-.04-.06V6.34a4.52 4.52 0 0 1 7.37-3.48l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68v6.77Zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z"
        fill="#10a37f"
      />
    </svg>
  );
}

export function ClaudeLogoIcon({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      <path
        d="M16.98 5.47L12 2 7.02 5.47 2 8.53v6.94l5.02 3.06L12 22l4.98-3.47L22 15.47V8.53l-5.02-3.06zM12 16.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"
        fill="#D97757"
        opacity="0.9"
      />
    </svg>
  );
}

export function AntigravityLogoIcon({ className, ...props }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      <path
        d="M12 3.25c-4.83 0-8.75 3.92-8.75 8.75S7.17 20.75 12 20.75c2.85 0 5.38-1.37 6.98-3.48"
        stroke="#4285F4"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14.25 7.25c3.04 0 5.5 2.46 5.5 5.5 0 1.96-1.02 3.67-2.56 4.65"
        stroke="#34A853"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.8"
      />
      <circle cx="12" cy="12" r="2.4" fill="#EA4335" opacity="0.92" />
      <path
        d="M16.8 6.2l.95 2.05 2.05.95-2.05.95-.95 2.05-.95-2.05-2.05-.95 2.05-.95.95-2.05Z"
        fill="#FBBC05"
      />
    </svg>
  );
}
