import { db } from "../db";
import { integrationProviders, integrationTools } from "@shared/schema";

type SeedResult = {
  insertedProviders: number;
  insertedTools: number;
  providersTotal: number;
  toolsTotal: number;
};

// Intentionally minimal "starter catalog" so the Integrations UI is never empty.
// OAuth flows can be implemented incrementally per provider; the catalog itself is harmless metadata.
export const DEFAULT_INTEGRATION_PROVIDERS: Array<{
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  authType: string;
  authConfig: Record<string, unknown>;
  category: string;
  isActive: string;
}> = [
  {
    id: "github",
    name: "GitHub",
    description: "Control de versiones y colaboración de código",
    iconUrl: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "user", "read:org"],
    },
    category: "development",
    isActive: "true",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Diseño colaborativo y prototipado",
    iconUrl: "https://static.figma.com/app/icon/1/favicon.svg",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://www.figma.com/oauth",
      tokenUrl: "https://www.figma.com/api/oauth/token",
      scopes: ["file_read", "file_write"],
    },
    category: "design",
    isActive: "true",
  },
  {
    id: "canva",
    name: "Canva",
    description: "Diseño gráfico y contenido visual",
    iconUrl: "https://static.canva.com/static/images/canva-logo.svg",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://www.canva.com/api/oauth/authorize",
      tokenUrl: "https://www.canva.com/api/oauth/token",
      scopes: ["design:content:read", "design:content:write"],
    },
    category: "design",
    isActive: "true",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Comunicación y mensajería de equipo",
    iconUrl: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scopes: ["channels:read", "chat:write", "users:read"],
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Notas, documentación y gestión de proyectos",
    iconUrl: "https://www.notion.so/images/logo-ios.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      scopes: [],
    },
    category: "productivity",
    isActive: "true",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Almacenamiento y documentos en la nube",
    iconUrl: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    },
    category: "productivity",
    isActive: "true",
  },
];

export const DEFAULT_INTEGRATION_TOOLS: Array<{
  id: string;
  providerId: string;
  name: string;
  description: string;
  requiredScopes: string[];
  dataAccessLevel: string;
  confirmationRequired: string;
  isActive: string;
}> = [
  {
    id: "github:list_repos",
    providerId: "github",
    name: "Listar repositorios",
    description: "Lista los repositorios del usuario",
    requiredScopes: ["repo"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "github:create_issue",
    providerId: "github",
    name: "Crear issue",
    description: "Crea un nuevo issue en un repositorio",
    requiredScopes: ["repo"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "github:get_file",
    providerId: "github",
    name: "Obtener archivo",
    description: "Lee el contenido de un archivo",
    requiredScopes: ["repo"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "figma:get_file",
    providerId: "figma",
    name: "Obtener archivo",
    description: "Obtiene información de un archivo Figma",
    requiredScopes: ["file_read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "figma:export_frame",
    providerId: "figma",
    name: "Exportar frame",
    description: "Exporta un frame como imagen",
    requiredScopes: ["file_read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "canva:list_designs",
    providerId: "canva",
    name: "Listar diseños",
    description: "Lista los diseños del usuario",
    requiredScopes: ["design:content:read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "canva:export_design",
    providerId: "canva",
    name: "Exportar diseño",
    description: "Exporta un diseño como imagen",
    requiredScopes: ["design:content:read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "slack:send_message",
    providerId: "slack",
    name: "Enviar mensaje",
    description: "Envía un mensaje a un canal",
    requiredScopes: ["chat:write"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "slack:list_channels",
    providerId: "slack",
    name: "Listar canales",
    description: "Lista los canales disponibles",
    requiredScopes: ["channels:read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "notion:search",
    providerId: "notion",
    name: "Buscar páginas",
    description: "Busca páginas en el workspace",
    requiredScopes: [],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "notion:get_page",
    providerId: "notion",
    name: "Obtener página",
    description: "Obtiene el contenido de una página",
    requiredScopes: [],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "google_drive:list_files",
    providerId: "google_drive",
    name: "Listar archivos",
    description: "Lista archivos en Drive",
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "google_drive:get_file",
    providerId: "google_drive",
    name: "Obtener archivo",
    description: "Obtiene contenido de un archivo",
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
];

export async function seedIntegrationCatalog(): Promise<SeedResult> {
  const insertedProviders = await db
    .insert(integrationProviders)
    .values(DEFAULT_INTEGRATION_PROVIDERS as any)
    .onConflictDoNothing()
    .returning({ id: integrationProviders.id });

  const insertedTools = await db
    .insert(integrationTools)
    .values(DEFAULT_INTEGRATION_TOOLS as any)
    .onConflictDoNothing()
    .returning({ id: integrationTools.id });

  const providersTotal = (await db.select({ id: integrationProviders.id }).from(integrationProviders)).length;
  const toolsTotal = (await db.select({ id: integrationTools.id }).from(integrationTools)).length;

  return {
    insertedProviders: insertedProviders.length,
    insertedTools: insertedTools.length,
    providersTotal,
    toolsTotal,
  };
}

export async function ensureIntegrationCatalogSeeded(): Promise<SeedResult> {
  const anyProvider = await db.select({ id: integrationProviders.id }).from(integrationProviders).limit(1);
  if (anyProvider.length > 0) {
    const providersTotal = (await db.select({ id: integrationProviders.id }).from(integrationProviders)).length;
    const toolsTotal = (await db.select({ id: integrationTools.id }).from(integrationTools)).length;
    return { insertedProviders: 0, insertedTools: 0, providersTotal, toolsTotal };
  }
  return seedIntegrationCatalog();
}

