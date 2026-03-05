import fs from 'fs/promises';
import path from 'path';

const apps = [
  { id: "adobe-acrobat", name: "Adobe Acrobat", category: "productivity" },
  { id: "adobe-express", name: "Adobe Express", category: "productivity" },
  { id: "adobe-photoshop", name: "Adobe Photoshop", category: "productivity" },
  { id: "agentforce-sales", name: "Agentforce Sales", category: "productivity" },
  { id: "aha", name: "Aha!", category: "productivity" },
  { id: "airtable", name: "Airtable", category: "productivity" },
  { id: "asana", name: "Asana", category: "productivity" },
  { id: "atlassian-rovo", name: "Atlassian Rovo", category: "productivity" },
  { id: "azure-boards", name: "Azure Boards", category: "productivity" },
  { id: "basecamp", name: "Basecamp", category: "productivity" },
  { id: "box", name: "Box", category: "productivity" },
  { id: "canva", name: "Canva", category: "productivity" },
  { id: "clay", name: "Clay", category: "productivity" },
  { id: "cloudinary", name: "Cloudinary", category: "productivity" },
  { id: "conductor", name: "Conductor", category: "productivity" },
  { id: "google-contacts", name: "Contactos de Google", category: "productivity" },
  { id: "coursera", name: "Coursera", category: "lifestyle" },
  { id: "daloopa", name: "Daloopa", category: "productivity" },
  { id: "dropbox", name: "Dropbox", category: "productivity" },
  { id: "egnyte", name: "Egnyte", category: "productivity" },
  { id: "gitlab-issues", name: "GitLab Issues", category: "productivity" },
  { id: "google-forms", name: "Formularios de Google", category: "productivity" },
  { id: "help-scout", name: "Help Scout", category: "productivity" },
  { id: "hex", name: "Hex", category: "productivity" },
  { id: "highlevel", name: "HighLevel", category: "productivity" },
  { id: "hugging-face", name: "Hugging Face", category: "productivity" },
  { id: "jotform", name: "Jotform", category: "productivity" },
  { id: "klaviyo", name: "Klaviyo", category: "productivity" },
  { id: "linear", name: "Linear", category: "productivity" },
  { id: "lovable", name: "Lovable", category: "productivity" },
  { id: "lseg", name: "LSEG", category: "productivity" },
  { id: "monday", name: "Monday.com", category: "productivity" },
  { id: "netlify", name: "Netlify", category: "productivity" },
  { id: "pipedrive", name: "Pipedrive", category: "productivity" },
  { id: "pitchbook", name: "PitchBook", category: "productivity" },
  { id: "replit", name: "Replit", category: "productivity" },
  { id: "sharepoint", name: "SharePoint", category: "productivity" },
  { id: "stripe", name: "Stripe", category: "productivity" },
  { id: "teams", name: "Teams", category: "productivity" },
  { id: "teamwork", name: "Teamwork.com", category: "productivity" },
  { id: "vercel", name: "Vercel", category: "productivity" },
  { id: "zoho", name: "Zoho", category: "productivity" },
  { id: "zoho-desk", name: "Zoho Desk", category: "productivity" },
  { id: "zoom", name: "Zoom", category: "productivity" },
  { id: "apple-music", name: "Apple Music", category: "lifestyle" },
  { id: "booking", name: "Booking.com", category: "lifestyle" },
  { id: "opentable", name: "OpenTable", category: "lifestyle" },
  { id: "tripadvisor", name: "Tripadvisor", category: "lifestyle" },
  { id: "codex", name: "Codex", category: "featured" },
  { id: "outlook-mail", name: "Correo electrónico de Outlook", category: "productivity" },
  { id: "outlook-calendar", name: "Calendario de Outlook", category: "productivity" }
];

async function generate() {
  const __dirname = process.cwd() + '/scripts';
  const baseDir = path.resolve(__dirname, '../server/integrations/connectors');
  for (const app of apps) {
    const dir = path.join(baseDir, app.id);
    await fs.mkdir(dir, { recursive: true });

    const envPrefix = app.id.toUpperCase().replace(/-/g, '_');

    // manifest.ts
    const manifestName = `${app.id.replace(/-/g, '')}Manifest`;
    const manifestContent = `import type { ConnectorManifest } from "../../kernel/types";

export const ${manifestName}: ConnectorManifest = {
  connectorId: "${app.id}",
  version: "1.0.0",
  displayName: "${app.name}",
  category: "${app.category}" as any,
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://example.com/oauth/authorize",
    tokenUrl: "https://example.com/oauth/token",
    scopes: ["read"],
    pkce: false,
    offlineAccess: true,
  },
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["${envPrefix}_CLIENT_ID", "${envPrefix}_CLIENT_SECRET"],
  capabilities: [
    {
      operationId: "${app.id.replace(/-/g, '_')}_get_status",
      description: "Get current status or basic info for ${app.name}",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
};
`;
    await fs.writeFile(path.join(dir, 'manifest.ts'), manifestContent);

    // handler.ts
    const handlerContent = `import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";

export const createHandler = (): ConnectorHandlerFactory => {
  return {
    async execute(operationId, input, credential) {
      if (operationId === "${app.id.replace(/-/g, '_')}_get_status") {
        return {
          success: true,
          data: { status: "ok", message: "${app.name} is connected" },
        };
      }
      return {
        success: false,
        error: {
          code: "UNKNOWN_OPERATION",
          message: \`Unknown operation: \${operationId}\`,
          retryable: false,
        },
      };
    },
  };
};

export const handler = createHandler();
`;
    await fs.writeFile(path.join(dir, 'handler.ts'), handlerContent);

    // index.ts
    const indexContent = `export { ${manifestName} } from "./manifest";
export { handler } from "./handler";
`;
    await fs.writeFile(path.join(dir, 'index.ts'), indexContent);
    console.log(`Generated ${app.id}`);
  }
}

generate().catch(console.error);
