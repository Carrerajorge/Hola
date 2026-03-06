import * as chalkModule from "chalk";
import { LOBSTER_PALETTE } from "./palette.js";

type ChalkLike = {
  hex: (value: string) => (input: string) => string;
  bold: {
    hex: (value: string) => (input: string) => string;
  };
  level: number;
};

type ChalkConstructor = new (options?: { level?: number }) => ChalkLike;

const chalkExports = chalkModule as Record<string, unknown>;
const chalkFactory = (typeof chalkModule.default === "function"
  ? chalkModule.default
  : chalkModule) as ChalkLike;
const ChalkCtor = (Reflect.get(chalkExports, "Chalk") ??
  Reflect.get(chalkExports, "Instance")) as ChalkConstructor | undefined;

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk =
  process.env.NO_COLOR && !hasForceColor
    ? ChalkCtor
      ? new ChalkCtor({ level: 0 })
      : chalkFactory
    : chalkFactory;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(LOBSTER_PALETTE.accent),
  accentBright: hex(LOBSTER_PALETTE.accentBright),
  accentDim: hex(LOBSTER_PALETTE.accentDim),
  info: hex(LOBSTER_PALETTE.info),
  success: hex(LOBSTER_PALETTE.success),
  warn: hex(LOBSTER_PALETTE.warn),
  error: hex(LOBSTER_PALETTE.error),
  muted: hex(LOBSTER_PALETTE.muted),
  heading: baseChalk.bold.hex(LOBSTER_PALETTE.accent),
  command: hex(LOBSTER_PALETTE.accentBright),
  option: hex(LOBSTER_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
