import type { SuperAgentSection } from "./superAgentCapabilities";

export type SupportedOS = "linux" | "darwin" | "win32";

export interface CapabilityRequirement {
  env?: string[]; // All required env vars
  envAnyOf?: string[][]; // At least one set of env vars must be present
  os?: SupportedOS[]; // Supported OS list
  notes?: string; // Human-readable hint
}

const SMTP_ENV = ["EMAIL_SMTP_HOST", "EMAIL_SMTP_USER", "EMAIL_SMTP_PASS", "EMAIL_FROM"];
const GOOGLE_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

export const SECTION_REQUIREMENTS: Partial<Record<SuperAgentSection, CapabilityRequirement>> = {
  "CORREO ELECTRÓNICO (21-30)": {
    envAnyOf: [SMTP_ENV, GOOGLE_ENV],
    notes: "Requiere SMTP o credenciales OAuth de Google",
  },
  "CALENDARIO (41-50)": {
    env: GOOGLE_ENV,
    notes: "Requiere credenciales OAuth de Google Calendar",
  },
};

export const CAPABILITY_REQUIREMENTS: Record<number, CapabilityRequirement> = {
  // WhatsApp & messaging capabilities typically need device pairing/session
  31: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  32: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  33: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  34: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  35: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  36: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  37: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  38: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  39: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
  40: { notes: "Requiere sesión de WhatsApp activa o proveedor externo" },
};
