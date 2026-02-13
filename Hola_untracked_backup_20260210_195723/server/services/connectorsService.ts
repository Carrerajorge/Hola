/**
 * Connectors & Integrations Service
 * Capabilities 751-800: Email, messaging, cloud storage, databases, CRM, dev tools
 *
 * Provides a unified abstraction layer for registering, managing, and invoking
 * external platform connectors. Messaging connectors use the native Node.js
 * https/http modules to make real HTTP requests. Config generators produce
 * proper payloads, connection strings, CLI commands, and integration code.
 */

import https from "https";
import http from "http";
import crypto from "crypto";

// ============================================
// TYPES
// ============================================

export interface ConnectorConfig {
  name: string;
  type: string;
  credentials?: Record<string, string>;
  baseUrl?: string;
  enabled: boolean;
}

export interface ConnectorResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: { latencyMs: number; connector: string };
}

// ============================================
// CONNECTOR REGISTRY
// ============================================

const connectors = new Map<string, ConnectorConfig>();

export function registerConnector(config: ConnectorConfig): { registered: boolean; name: string } {
  connectors.set(config.name, { ...config });
  return { registered: true, name: config.name };
}

export function getConnector(name: string): ConnectorConfig | null {
  return connectors.get(name) ?? null;
}

export function listConnectors(): ConnectorConfig[] {
  return Array.from(connectors.values());
}

export function removeConnector(name: string): boolean {
  return connectors.delete(name);
}

export async function testConnector(name: string): Promise<ConnectorResult> {
  const start = Date.now();
  const connector = connectors.get(name);
  if (!connector) {
    return {
      success: false,
      error: `Connector "${name}" not found`,
      metadata: { latencyMs: Date.now() - start, connector: name },
    };
  }
  if (!connector.enabled) {
    return {
      success: false,
      error: `Connector "${name}" is disabled`,
      metadata: { latencyMs: Date.now() - start, connector: name },
    };
  }

  // If there is a baseUrl, attempt a HEAD request to verify reachability
  if (connector.baseUrl) {
    try {
      await httpRequest(connector.baseUrl, {
        method: "HEAD",
        timeoutMs: 5000,
      });
      return {
        success: true,
        data: { status: "reachable" },
        metadata: { latencyMs: Date.now() - start, connector: name },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Connector "${name}" unreachable: ${message}`,
        metadata: { latencyMs: Date.now() - start, connector: name },
      };
    }
  }

  return {
    success: true,
    data: { status: "configured" },
    metadata: { latencyMs: Date.now() - start, connector: name },
  };
}

// ============================================
// INTERNAL HTTP HELPER
// ============================================

interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

function httpRequest(
  url: string,
  opts: HttpRequestOptions = {}
): Promise<{ statusCode: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const reqOpts: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...opts.headers,
      },
      timeout: opts.timeoutMs ?? 15000,
    };

    if (opts.body) {
      (reqOpts.headers as Record<string, string>)["Content-Length"] = Buffer.byteLength(opts.body).toString();
    }

    const req = transport.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (typeof val === "string") responseHeaders[key] = val;
          else if (Array.isArray(val)) responseHeaders[key] = val.join(", ");
        }
        resolve({ statusCode: res.statusCode ?? 0, body, headers: responseHeaders });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ============================================
// 751-760: MESSAGING CONNECTORS
// ============================================

/** 751. Send a Slack message via Incoming Webhook */
export async function sendSlackMessage(config: {
  webhookUrl?: string;
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<ConnectorResult> {
  const start = Date.now();
  const connector = connectors.get("slack");
  const webhookUrl = config.webhookUrl ?? connector?.credentials?.webhookUrl;
  if (!webhookUrl) {
    return {
      success: false,
      error: "No Slack webhook URL provided and no 'slack' connector registered with webhookUrl credential",
      metadata: { latencyMs: Date.now() - start, connector: "slack" },
    };
  }

  const payload: Record<string, unknown> = {
    channel: config.channel,
    text: config.text,
  };
  if (config.blocks && config.blocks.length > 0) {
    payload.blocks = config.blocks;
  }

  try {
    const res = await httpRequest(webhookUrl, { body: JSON.stringify(payload) });
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return {
      success: ok,
      data: ok ? { response: res.body } : undefined,
      error: ok ? undefined : `Slack returned ${res.statusCode}: ${res.body}`,
      metadata: { latencyMs: Date.now() - start, connector: "slack" },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      metadata: { latencyMs: Date.now() - start, connector: "slack" },
    };
  }
}

/** 752. Send a Discord message via Webhook */
export async function sendDiscordMessage(config: {
  webhookUrl: string;
  content: string;
  embeds?: unknown[];
}): Promise<ConnectorResult> {
  const start = Date.now();
  const payload: Record<string, unknown> = { content: config.content };
  if (config.embeds && config.embeds.length > 0) {
    payload.embeds = config.embeds;
  }

  try {
    const res = await httpRequest(config.webhookUrl, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return {
      success: ok,
      data: ok ? (res.body ? JSON.parse(res.body) : {}) : undefined,
      error: ok ? undefined : `Discord returned ${res.statusCode}: ${res.body}`,
      metadata: { latencyMs: Date.now() - start, connector: "discord" },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      metadata: { latencyMs: Date.now() - start, connector: "discord" },
    };
  }
}

/** 753. Send a Microsoft Teams message via Incoming Webhook */
export async function sendTeamsMessage(config: {
  webhookUrl: string;
  text: string;
  title?: string;
}): Promise<ConnectorResult> {
  const start = Date.now();
  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: config.title ?? "Notification",
    themeColor: "0076D7",
    title: config.title ?? "",
    sections: [
      {
        activityTitle: config.title ?? "Message",
        text: config.text,
      },
    ],
  };

  try {
    const res = await httpRequest(config.webhookUrl, { body: JSON.stringify(card) });
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return {
      success: ok,
      data: ok ? { response: res.body } : undefined,
      error: ok ? undefined : `Teams returned ${res.statusCode}: ${res.body}`,
      metadata: { latencyMs: Date.now() - start, connector: "teams" },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      metadata: { latencyMs: Date.now() - start, connector: "teams" },
    };
  }
}

/** 754. Send a Telegram message via Bot API */
export async function sendTelegramMessage(config: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: string;
}): Promise<ConnectorResult> {
  const start = Date.now();
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: config.chatId,
    text: config.text,
  };
  if (config.parseMode) {
    payload.parse_mode = config.parseMode;
  }

  try {
    const res = await httpRequest(url, { body: JSON.stringify(payload) });
    const parsed = JSON.parse(res.body);
    return {
      success: parsed.ok === true,
      data: parsed.result ?? parsed,
      error: parsed.ok ? undefined : parsed.description ?? `Telegram returned ${res.statusCode}`,
      metadata: { latencyMs: Date.now() - start, connector: "telegram" },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      metadata: { latencyMs: Date.now() - start, connector: "telegram" },
    };
  }
}

// ============================================
// 761-770: CLOUD STORAGE CONFIG GENERATORS
// ============================================

/** 761. AWS S3 configuration helper */
export function generateS3Config(
  bucket: string,
  region: string,
  prefix?: string
): {
  uploadUrl: string;
  downloadUrl: string;
  listCommand: string;
  syncCommand: string;
} {
  const s3Path = prefix ? `s3://${bucket}/${prefix}` : `s3://${bucket}`;
  return {
    uploadUrl: `https://${bucket}.s3.${region}.amazonaws.com/${prefix ?? ""}`,
    downloadUrl: `https://${bucket}.s3.${region}.amazonaws.com/${prefix ?? ""}`,
    listCommand: `aws s3 ls ${s3Path} --region ${region}`,
    syncCommand: `aws s3 sync . ${s3Path} --region ${region}`,
  };
}

/** 762. Google Cloud Storage configuration helper */
export function generateGCSConfig(
  bucket: string,
  project: string
): {
  uploadCommand: string;
  downloadCommand: string;
  listCommand: string;
} {
  return {
    uploadCommand: `gsutil -o "GSUtil:default_project_id=${project}" cp FILE gs://${bucket}/`,
    downloadCommand: `gsutil -o "GSUtil:default_project_id=${project}" cp gs://${bucket}/FILE .`,
    listCommand: `gsutil ls gs://${bucket}/`,
  };
}

/** 763. Azure Blob Storage configuration helper */
export function generateAzureBlobConfig(
  container: string,
  account: string
): {
  uploadCommand: string;
  downloadCommand: string;
  listCommand: string;
} {
  return {
    uploadCommand: `az storage blob upload --account-name ${account} --container-name ${container} --file FILE --name BLOB_NAME`,
    downloadCommand: `az storage blob download --account-name ${account} --container-name ${container} --name BLOB_NAME --file OUTPUT_FILE`,
    listCommand: `az storage blob list --account-name ${account} --container-name ${container} --output table`,
  };
}

// ============================================
// 771-780: DATABASE CONNECTORS
// ============================================

/** 771. Generate a database connection string */
export function generateConnectionString(config: {
  type: "postgresql" | "mysql" | "mongodb" | "redis" | "elasticsearch";
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
  options?: Record<string, string>;
}): string {
  const { type, host, port, database, user, password, options } = config;
  const auth = user ? (password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : `${encodeURIComponent(user)}@`) : "";

  let optionString = "";
  if (options && Object.keys(options).length > 0) {
    const pairs = Object.entries(options).map(([k, v]) => `${k}=${v}`);
    optionString = type === "mongodb" ? `?${pairs.join("&")}` : `?${pairs.join("&")}`;
  }

  switch (type) {
    case "postgresql":
      return `postgresql://${auth}${host}:${port}/${database}${optionString}`;
    case "mysql":
      return `mysql://${auth}${host}:${port}/${database}${optionString}`;
    case "mongodb":
      return `mongodb://${auth}${host}:${port}/${database}${optionString}`;
    case "redis": {
      if (password) {
        return `redis://:${encodeURIComponent(password)}@${host}:${port}/${database}${optionString}`;
      }
      return `redis://${host}:${port}/${database}${optionString}`;
    }
    case "elasticsearch":
      return `${auth ? "https" : "http"}://${auth}${host}:${port}/${database}${optionString}`;
    default:
      return `${type}://${auth}${host}:${port}/${database}${optionString}`;
  }
}

/** 772. Generate SQL DDL for a database schema */
export function generateDatabaseSchema(config: {
  type: "postgresql" | "mysql";
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      primaryKey?: boolean;
      references?: string;
    }>;
    indexes?: Array<{ columns: string[]; unique?: boolean }>;
  }>;
}): string {
  const statements: string[] = [];

  for (const table of config.tables) {
    const colDefs: string[] = [];
    const pks: string[] = [];
    const fks: string[] = [];

    for (const col of table.columns) {
      let def = `  "${col.name}" ${col.type}`;
      if (col.nullable === false) def += " NOT NULL";
      if (col.primaryKey) pks.push(`"${col.name}"`);
      if (col.references) {
        const [refTable, refCol] = col.references.split(".");
        fks.push(
          `  CONSTRAINT "fk_${table.name}_${col.name}" FOREIGN KEY ("${col.name}") REFERENCES "${refTable}" ("${refCol}")`
        );
      }
      colDefs.push(def);
    }

    if (pks.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pks.join(", ")})`);
    }

    const allDefs = [...colDefs, ...fks].join(",\n");
    statements.push(`CREATE TABLE "${table.name}" (\n${allDefs}\n);`);

    if (table.indexes) {
      for (const idx of table.indexes) {
        const idxName = `idx_${table.name}_${idx.columns.join("_")}`;
        const unique = idx.unique ? "UNIQUE " : "";
        const cols = idx.columns.map((c) => `"${c}"`).join(", ");
        statements.push(`CREATE ${unique}INDEX "${idxName}" ON "${table.name}" (${cols});`);
      }
    }
  }

  return statements.join("\n\n");
}

// ============================================
// 781-786: VECTOR DB CONNECTORS
// ============================================

/** 781. Pinecone configuration and code examples */
export function generatePineconeConfig(config: {
  apiKey: string;
  environment: string;
  indexName: string;
}): {
  upsertExample: string;
  queryExample: string;
  deleteExample: string;
} {
  const masked = config.apiKey.slice(0, 4) + "..." + config.apiKey.slice(-4);
  return {
    upsertExample: `import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: '${masked}' });
const index = pc.index('${config.indexName}');

await index.namespace('default').upsert([
  { id: 'vec-1', values: [0.1, 0.2, 0.3, /* ... */], metadata: { text: 'example' } },
]);`,
    queryExample: `const results = await index.namespace('default').query({
  vector: [0.1, 0.2, 0.3, /* ... */],
  topK: 10,
  includeMetadata: true,
});

console.log(results.matches);`,
    deleteExample: `// Delete by IDs
await index.namespace('default').deleteMany(['vec-1', 'vec-2']);

// Delete all vectors in a namespace
await index.namespace('default').deleteAll();`,
  };
}

/** 782. Weaviate configuration and code examples */
export function generateWeaviateConfig(config: {
  url: string;
  className: string;
}): {
  schemaExample: string;
  insertExample: string;
  queryExample: string;
} {
  return {
    schemaExample: `import weaviate from 'weaviate-ts-client';

const client = weaviate.client({ scheme: 'https', host: '${config.url.replace(/^https?:\/\//, "")}' });

await client.schema.classCreator().withClass({
  class: '${config.className}',
  vectorizer: 'text2vec-openai',
  properties: [
    { name: 'content', dataType: ['text'] },
    { name: 'source', dataType: ['string'] },
  ],
}).do();`,
    insertExample: `await client.data.creator()
  .withClassName('${config.className}')
  .withProperties({ content: 'Example text', source: 'docs' })
  .do();`,
    queryExample: `const result = await client.graphql.get()
  .withClassName('${config.className}')
  .withNearText({ concepts: ['search query'] })
  .withLimit(10)
  .withFields('content source _additional { distance }')
  .do();

console.log(result.data.Get.${config.className});`,
  };
}

/** 783. Qdrant configuration and code examples */
export function generateQdrantConfig(config: {
  url: string;
  collectionName: string;
  vectorSize: number;
}): {
  createCollectionExample: string;
  upsertExample: string;
  searchExample: string;
} {
  return {
    createCollectionExample: `import { QdrantClient } from '@qdrant/js-client-rest';

const client = new QdrantClient({ url: '${config.url}' });

await client.createCollection('${config.collectionName}', {
  vectors: { size: ${config.vectorSize}, distance: 'Cosine' },
});`,
    upsertExample: `await client.upsert('${config.collectionName}', {
  wait: true,
  points: [
    { id: 1, vector: Array(${config.vectorSize}).fill(0), payload: { text: 'example' } },
  ],
});`,
    searchExample: `const results = await client.search('${config.collectionName}', {
  vector: Array(${config.vectorSize}).fill(0),
  limit: 10,
  with_payload: true,
});

console.log(results);`,
  };
}

// ============================================
// 787-792: CRM & PROJECT MANAGEMENT
// ============================================

/** 787. Generate a Jira ticket payload and curl command */
export function generateJiraTicket(config: {
  project: string;
  summary: string;
  description: string;
  issueType: "Bug" | "Story" | "Task" | "Epic";
  priority?: string;
  labels?: string[];
  assignee?: string;
}): { apiPayload: object; curlCommand: string } {
  const fields: Record<string, unknown> = {
    project: { key: config.project },
    summary: config.summary,
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: config.description }],
        },
      ],
    },
    issuetype: { name: config.issueType },
  };

  if (config.priority) {
    fields.priority = { name: config.priority };
  }
  if (config.labels && config.labels.length > 0) {
    fields.labels = config.labels;
  }
  if (config.assignee) {
    fields.assignee = { accountId: config.assignee };
  }

  const apiPayload = { fields };
  const payloadJson = JSON.stringify(apiPayload);
  const escaped = payloadJson.replace(/'/g, "'\\''");

  const curlCommand = [
    "curl -X POST",
    "  -H 'Authorization: Basic <BASE64_EMAIL:API_TOKEN>'",
    "  -H 'Content-Type: application/json'",
    `  -d '${escaped}'`,
    "  'https://<YOUR_DOMAIN>.atlassian.net/rest/api/3/issue'",
  ].join(" \\\n");

  return { apiPayload, curlCommand };
}

/** 788. Generate a GitHub issue payload and curl command */
export function generateGitHubIssue(config: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}): { apiPayload: object; curlCommand: string } {
  const apiPayload: Record<string, unknown> = {
    title: config.title,
    body: config.body,
  };
  if (config.labels && config.labels.length > 0) {
    apiPayload.labels = config.labels;
  }
  if (config.assignees && config.assignees.length > 0) {
    apiPayload.assignees = config.assignees;
  }

  const payloadJson = JSON.stringify(apiPayload);
  const escaped = payloadJson.replace(/'/g, "'\\''");

  const curlCommand = [
    "curl -X POST",
    "  -H 'Authorization: Bearer <GITHUB_TOKEN>'",
    "  -H 'Accept: application/vnd.github+json'",
    "  -H 'X-GitHub-Api-Version: 2022-11-28'",
    `  -d '${escaped}'`,
    `  'https://api.github.com/repos/${config.owner}/${config.repo}/issues'`,
  ].join(" \\\n");

  return { apiPayload, curlCommand };
}

/** 789. Generate a Notion page payload */
export function generateNotionPage(config: {
  parentId: string;
  title: string;
  content: Array<{
    type: "paragraph" | "heading_1" | "heading_2" | "bulleted_list_item" | "code";
    text: string;
  }>;
}): { apiPayload: object } {
  const children = config.content.map((block) => {
    if (block.type === "code") {
      return {
        object: "block" as const,
        type: "code" as const,
        code: {
          rich_text: [{ type: "text" as const, text: { content: block.text } }],
          language: "typescript",
        },
      };
    }
    return {
      object: "block" as const,
      type: block.type,
      [block.type]: {
        rich_text: [{ type: "text" as const, text: { content: block.text } }],
      },
    };
  });

  const apiPayload = {
    parent: { page_id: config.parentId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: config.title } }],
      },
    },
    children,
  };

  return { apiPayload };
}

// ============================================
// 793-794: PAYMENT CONNECTORS
// ============================================

/** 793. Generate Stripe Checkout Session configuration */
export function generateStripeCheckoutConfig(config: {
  priceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
  mode: "payment" | "subscription";
}): { apiPayload: object; integrationCode: string } {
  const apiPayload = {
    line_items: [
      {
        price: config.priceId,
        quantity: config.quantity,
      },
    ],
    mode: config.mode,
    success_url: config.successUrl,
    cancel_url: config.cancelUrl,
  };

  const integrationCode = `import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

const session = await stripe.checkout.sessions.create({
  line_items: [
    {
      price: '${config.priceId}',
      quantity: ${config.quantity},
    },
  ],
  mode: '${config.mode}',
  success_url: '${config.successUrl}',
  cancel_url: '${config.cancelUrl}',
});

// Redirect the user to session.url`;

  return { apiPayload, integrationCode };
}

/** 794. Generate PayPal configuration */
export function generatePayPalConfig(config: {
  clientId: string;
  amount: number;
  currency: string;
  description: string;
}): { sdkScript: string; integrationCode: string } {
  const maskedId = config.clientId.slice(0, 6) + "..." + config.clientId.slice(-4);

  const sdkScript = `<script src="https://www.paypal.com/sdk/js?client-id=${maskedId}&currency=${config.currency}"></script>`;

  const integrationCode = `paypal.Buttons({
  createOrder: function(data, actions) {
    return actions.order.create({
      purchase_units: [{
        description: '${config.description.replace(/'/g, "\\'")}',
        amount: {
          currency_code: '${config.currency}',
          value: '${config.amount.toFixed(2)}',
        },
      }],
    });
  },
  onApprove: function(data, actions) {
    return actions.order.capture().then(function(details) {
      console.log('Transaction completed by', details.payer.name.given_name);
    });
  },
  onError: function(err) {
    console.error('PayPal error:', err);
  },
}).render('#paypal-button-container');`;

  return { sdkScript, integrationCode };
}

// ============================================
// 795-796: COMMUNICATION CONNECTORS
// ============================================

/** 795. Generate Twilio SMS configuration */
export function generateTwilioSMSConfig(config: {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
}): { curlCommand: string; nodeCode: string } {
  const escapedBody = config.body.replace(/'/g, "'\\''");

  const curlCommand = [
    `curl -X POST 'https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json'`,
    `  --data-urlencode 'From=${config.from}'`,
    `  --data-urlencode 'To=${config.to}'`,
    `  --data-urlencode 'Body=${escapedBody}'`,
    `  -u '${config.accountSid}:${config.authToken}'`,
  ].join(" \\\n");

  const nodeCode = `import twilio from 'twilio';

const client = twilio('${config.accountSid}', process.env.TWILIO_AUTH_TOKEN);

const message = await client.messages.create({
  body: '${config.body.replace(/'/g, "\\'")}',
  from: '${config.from}',
  to: '${config.to}',
});

console.log('Message SID:', message.sid);`;

  return { curlCommand, nodeCode };
}

/** 796. Generate SendGrid email configuration */
export function generateSendGridConfig(config: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  htmlContent: string;
}): { apiPayload: object; nodeCode: string } {
  const maskedKey = config.apiKey.slice(0, 5) + "..." + config.apiKey.slice(-4);

  const apiPayload = {
    personalizations: [{ to: [{ email: config.to }] }],
    from: { email: config.from },
    subject: config.subject,
    content: [{ type: "text/html", value: config.htmlContent }],
  };

  const nodeCode = `import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? '${maskedKey}');

await sgMail.send({
  to: '${config.to}',
  from: '${config.from}',
  subject: '${config.subject.replace(/'/g, "\\'")}',
  html: \`${config.htmlContent}\`,
});`;

  return { apiPayload, nodeCode };
}

// ============================================
// 797-799: CI/CD PLATFORM CONNECTORS
// ============================================

/** 797. Generate vercel.json configuration */
export function generateVercelConfig(config: {
  framework: string;
  buildCommand?: string;
  outputDirectory?: string;
  env?: Record<string, string>;
}): string {
  const vercelJson: Record<string, unknown> = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: config.framework,
  };

  if (config.buildCommand) {
    vercelJson.buildCommand = config.buildCommand;
  }
  if (config.outputDirectory) {
    vercelJson.outputDirectory = config.outputDirectory;
  }
  if (config.env && Object.keys(config.env).length > 0) {
    vercelJson.env = config.env;
  }

  return JSON.stringify(vercelJson, null, 2);
}

/** 798. Generate netlify.toml configuration */
export function generateNetlifyConfig(config: {
  buildCommand: string;
  publishDir: string;
  redirects?: Array<{ from: string; to: string; status: number }>;
  headers?: Array<{ path: string; headers: Record<string, string> }>;
}): string {
  const lines: string[] = [];

  lines.push("[build]");
  lines.push(`  command = "${config.buildCommand}"`);
  lines.push(`  publish = "${config.publishDir}"`);
  lines.push("");

  if (config.redirects) {
    for (const r of config.redirects) {
      lines.push("[[redirects]]");
      lines.push(`  from = "${r.from}"`);
      lines.push(`  to = "${r.to}"`);
      lines.push(`  status = ${r.status}`);
      lines.push("");
    }
  }

  if (config.headers) {
    for (const h of config.headers) {
      lines.push("[[headers]]");
      lines.push(`  for = "${h.path}"`);
      lines.push("  [headers.values]");
      for (const [key, val] of Object.entries(h.headers)) {
        lines.push(`    ${key} = "${val}"`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** 799. Generate Heroku Procfile */
export function generateHerokuProcfile(config: {
  web: string;
  worker?: string;
  release?: string;
}): string {
  const lines: string[] = [];
  lines.push(`web: ${config.web}`);
  if (config.worker) {
    lines.push(`worker: ${config.worker}`);
  }
  if (config.release) {
    lines.push(`release: ${config.release}`);
  }
  return lines.join("\n");
}

// ============================================
// 800: WEBHOOK MANAGEMENT
// ============================================

interface WebhookEntry {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  retryPolicy: { maxRetries: number; backoffMs: number };
  createdAt: string;
}

const webhookRegistry = new Map<string, WebhookEntry>();

/** 800a. Create a webhook endpoint */
export function createWebhookEndpoint(config: {
  url: string;
  events: string[];
  secret?: string;
  retryPolicy?: { maxRetries: number; backoffMs: number };
}): { id: string; url: string; secret: string; createdAt: string } {
  const id = `whk_${crypto.randomBytes(12).toString("hex")}`;
  const secret = config.secret ?? crypto.randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();

  const entry: WebhookEntry = {
    id,
    url: config.url,
    events: config.events,
    secret,
    active: true,
    retryPolicy: config.retryPolicy ?? { maxRetries: 3, backoffMs: 1000 },
    createdAt,
  };

  webhookRegistry.set(id, entry);
  return { id, url: config.url, secret, createdAt };
}

/** 800b. Verify a webhook signature (HMAC-based) */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm: string = "sha256"
): boolean {
  const computed = crypto.createHmac(algorithm, secret).update(payload, "utf8").digest("hex");
  // Constant-time comparison to prevent timing attacks
  if (computed.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
  } catch {
    // If signature is not valid hex, fall back to string comparison with timing safety
    return crypto.timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(signature, "utf8"));
  }
}

/** 800c. List registered webhooks */
export function listWebhooks(): Array<{
  id: string;
  url: string;
  events: string[];
  active: boolean;
}> {
  return Array.from(webhookRegistry.values()).map((entry) => ({
    id: entry.id,
    url: entry.url,
    events: entry.events,
    active: entry.active,
  }));
}
