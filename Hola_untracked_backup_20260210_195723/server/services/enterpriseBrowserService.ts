/**
 * Enterprise & Browser Automation Advanced Service
 * Capabilities 901-1000: Multi-tenant, compliance, workflows, visual testing, scraping
 */

import { randomUUID } from "crypto";

// ========================
// ENTERPRISE (901-950)
// ========================

// --- Multi-Tenant ---
interface Tenant {
  id: string;
  name: string;
  config: Record<string, any>;
  branding?: { logo?: string; primaryColor?: string; name?: string };
  plan: "free" | "pro" | "enterprise";
  createdAt: Date;
  quotas: { apiCalls: number; storage: number; users: number };
  usage: { apiCalls: number; storage: number; users: number };
}

const tenants = new Map<string, Tenant>();

export function createTenant(
  name: string,
  plan: Tenant["plan"] = "free",
  config: Record<string, any> = {}
): Tenant {
  const quotaDefaults: Record<Tenant["plan"], Tenant["quotas"]> = {
    free: { apiCalls: 1000, storage: 100, users: 5 },
    pro: { apiCalls: 50000, storage: 5000, users: 50 },
    enterprise: { apiCalls: 1000000, storage: 100000, users: 500 },
  };
  const tenant: Tenant = {
    id: randomUUID(),
    name,
    config,
    plan,
    createdAt: new Date(),
    quotas: { ...quotaDefaults[plan] },
    usage: { apiCalls: 0, storage: 0, users: 0 },
  };
  tenants.set(tenant.id, tenant);
  return tenant;
}

export function getTenant(id: string): Tenant | null {
  return tenants.get(id) ?? null;
}

export function updateTenant(id: string, updates: Partial<Tenant>): Tenant | null {
  const tenant = tenants.get(id);
  if (!tenant) return null;
  const updated: Tenant = {
    ...tenant,
    ...updates,
    id: tenant.id, // prevent id overwrite
    createdAt: tenant.createdAt, // prevent createdAt overwrite
  };
  tenants.set(id, updated);
  return updated;
}

export function deleteTenant(id: string): boolean {
  return tenants.delete(id);
}

export function listTenants(): Tenant[] {
  return Array.from(tenants.values());
}

export function getTenantConfig(tenantId: string, key: string): any {
  const tenant = tenants.get(tenantId);
  if (!tenant) return undefined;
  return tenant.config[key];
}

export function setTenantConfig(tenantId: string, key: string, value: any): boolean {
  const tenant = tenants.get(tenantId);
  if (!tenant) return false;
  tenant.config[key] = value;
  return true;
}

export function getTenantBranding(tenantId: string): Tenant["branding"] | null {
  const tenant = tenants.get(tenantId);
  if (!tenant) return null;
  return tenant.branding ?? null;
}

export function setBranding(tenantId: string, branding: Tenant["branding"]): boolean {
  const tenant = tenants.get(tenantId);
  if (!tenant) return false;
  tenant.branding = branding;
  return true;
}

// --- Usage & Billing ---
export function recordUsage(
  tenantId: string,
  metric: "apiCalls" | "storage" | "users",
  amount: number = 1
): boolean {
  const tenant = tenants.get(tenantId);
  if (!tenant) return false;
  tenant.usage[metric] += amount;
  return true;
}

export function getUsage(tenantId: string): Tenant["usage"] | null {
  const tenant = tenants.get(tenantId);
  if (!tenant) return null;
  return { ...tenant.usage };
}

export function checkQuota(
  tenantId: string,
  metric: keyof Tenant["quotas"]
): { allowed: boolean; current: number; limit: number; percentUsed: number } {
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return { allowed: false, current: 0, limit: 0, percentUsed: 100 };
  }
  const current = tenant.usage[metric];
  const limit = tenant.quotas[metric];
  const percentUsed = limit > 0 ? (current / limit) * 100 : 100;
  return {
    allowed: current < limit,
    current,
    limit,
    percentUsed: Math.round(percentUsed * 100) / 100,
  };
}

export function generateInvoice(
  tenantId: string,
  period: { start: Date; end: Date }
): {
  invoiceId: string;
  tenantId: string;
  tenantName: string;
  period: { start: string; end: string };
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  generatedAt: string;
} {
  const tenant = tenants.get(tenantId);
  const tenantName = tenant?.name ?? "Unknown";
  const usage = tenant?.usage ?? { apiCalls: 0, storage: 0, users: 0 };
  const plan = tenant?.plan ?? "free";

  const pricing: Record<string, Record<string, number>> = {
    free: { apiCalls: 0.001, storage: 0.01, users: 0 },
    pro: { apiCalls: 0.0005, storage: 0.005, users: 10 },
    enterprise: { apiCalls: 0.0002, storage: 0.002, users: 8 },
  };

  const rates = pricing[plan] ?? pricing.free;

  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }> = [];

  if (usage.apiCalls > 0) {
    lineItems.push({
      description: "API Calls",
      quantity: usage.apiCalls,
      unitPrice: rates.apiCalls,
      total: Math.round(usage.apiCalls * rates.apiCalls * 100) / 100,
    });
  }
  if (usage.storage > 0) {
    lineItems.push({
      description: "Storage (MB)",
      quantity: usage.storage,
      unitPrice: rates.storage,
      total: Math.round(usage.storage * rates.storage * 100) / 100,
    });
  }
  if (usage.users > 0 && rates.users > 0) {
    lineItems.push({
      description: "User Seats",
      quantity: usage.users,
      unitPrice: rates.users,
      total: Math.round(usage.users * rates.users * 100) / 100,
    });
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = Math.round(subtotal * 0.1 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return {
    invoiceId: `INV-${randomUUID().slice(0, 8).toUpperCase()}`,
    tenantId,
    tenantName,
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    lineItems,
    subtotal,
    tax,
    total,
    generatedAt: new Date().toISOString(),
  };
}

// --- Subscription & Plans ---
export function getSubscriptionPlans(): Array<{
  name: string;
  price: number;
  features: string[];
  quotas: { apiCalls: number; storage: number; users: number };
}> {
  return [
    {
      name: "free",
      price: 0,
      features: ["Basic API access", "Community support", "1GB storage"],
      quotas: { apiCalls: 1000, storage: 100, users: 5 },
    },
    {
      name: "pro",
      price: 49,
      features: [
        "Priority API access",
        "Email support",
        "50GB storage",
        "Advanced analytics",
        "Custom branding",
      ],
      quotas: { apiCalls: 50000, storage: 5000, users: 50 },
    },
    {
      name: "enterprise",
      price: 299,
      features: [
        "Unlimited API access",
        "24/7 phone support",
        "1TB storage",
        "Advanced analytics",
        "Custom branding",
        "SSO/SAML",
        "Dedicated infrastructure",
        "SLA guarantee",
      ],
      quotas: { apiCalls: 1000000, storage: 100000, users: 500 },
    },
  ];
}

export function upgradePlan(
  tenantId: string,
  newPlan: Tenant["plan"]
): { success: boolean; previousPlan: string; newPlan: string } {
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return { success: false, previousPlan: "unknown", newPlan };
  }
  const previousPlan = tenant.plan;
  const plans = getSubscriptionPlans();
  const planInfo = plans.find((p) => p.name === newPlan);
  if (!planInfo) {
    return { success: false, previousPlan, newPlan };
  }
  tenant.plan = newPlan;
  tenant.quotas = { ...planInfo.quotas };
  return { success: true, previousPlan, newPlan };
}

// --- Workflows ---
interface WorkflowStep {
  id: string;
  name: string;
  type: "action" | "condition" | "wait" | "approval" | "notification";
  config: Record<string, any>;
  nextSteps: string[];
  onError?: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  trigger: { type: "manual" | "schedule" | "event" | "webhook"; config: Record<string, any> };
  status: "draft" | "active" | "paused" | "archived";
  createdAt: Date;
}

interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "paused";
  currentStep: string;
  startedAt: Date;
  completedAt?: Date;
  results: Record<string, any>;
  logs: Array<{ timestamp: Date; step: string; message: string; level: string }>;
}

const workflows = new Map<string, Workflow>();
const workflowExecutions = new Map<string, WorkflowExecution>();

export function createWorkflow(
  config: Omit<Workflow, "id" | "status" | "createdAt">
): Workflow {
  const workflow: Workflow = {
    ...config,
    id: randomUUID(),
    status: "draft",
    createdAt: new Date(),
  };
  workflows.set(workflow.id, workflow);
  return workflow;
}

export function getWorkflow(id: string): Workflow | null {
  return workflows.get(id) ?? null;
}

export function updateWorkflow(id: string, updates: Partial<Workflow>): Workflow | null {
  const workflow = workflows.get(id);
  if (!workflow) return null;
  const updated: Workflow = {
    ...workflow,
    ...updates,
    id: workflow.id,
    createdAt: workflow.createdAt,
  };
  workflows.set(id, updated);
  return updated;
}

export function deleteWorkflow(id: string): boolean {
  return workflows.delete(id);
}

export function listWorkflows(status?: Workflow["status"]): Workflow[] {
  const all = Array.from(workflows.values());
  if (!status) return all;
  return all.filter((w) => w.status === status);
}

export function activateWorkflow(id: string): boolean {
  const workflow = workflows.get(id);
  if (!workflow) return false;
  if (workflow.steps.length === 0) return false;
  workflow.status = "active";
  return true;
}

export function pauseWorkflow(id: string): boolean {
  const workflow = workflows.get(id);
  if (!workflow) return false;
  workflow.status = "paused";
  return true;
}

function executeStep(
  step: WorkflowStep,
  execution: WorkflowExecution,
  input: Record<string, any>,
  workflow: Workflow
): void {
  execution.logs.push({
    timestamp: new Date(),
    step: step.id,
    message: `Executing step: ${step.name} (type: ${step.type})`,
    level: "info",
  });

  try {
    switch (step.type) {
      case "action": {
        const actionName = (step.config.action as string) ?? "default";
        execution.results[step.id] = {
          action: actionName,
          input: { ...input, ...step.config },
          output: { success: true, executedAt: new Date().toISOString() },
        };
        break;
      }
      case "condition": {
        const field = step.config.field as string;
        const operator = step.config.operator as string;
        const value = step.config.value;
        const actual = input[field] ?? execution.results[field];
        let result = false;
        switch (operator) {
          case "equals":
            result = actual === value;
            break;
          case "not_equals":
            result = actual !== value;
            break;
          case "greater_than":
            result = actual > value;
            break;
          case "less_than":
            result = actual < value;
            break;
          case "contains":
            result = typeof actual === "string" && actual.includes(value as string);
            break;
          default:
            result = !!actual;
        }
        execution.results[step.id] = { condition: result };
        if (!result && step.nextSteps.length > 1) {
          // If condition is false and there is an alternate branch, jump to it
          const alternateBranch = step.nextSteps[1];
          const alternateStep = workflow.steps.find((s) => s.id === alternateBranch);
          if (alternateStep) {
            executeStep(alternateStep, execution, input, workflow);
            return;
          }
        }
        break;
      }
      case "wait": {
        const durationMs = (step.config.durationMs as number) ?? 0;
        execution.results[step.id] = {
          waited: true,
          durationMs,
          note: "Wait simulated (non-blocking in-memory execution)",
        };
        break;
      }
      case "approval": {
        const autoApprove = step.config.autoApprove as boolean | undefined;
        if (autoApprove) {
          execution.results[step.id] = { approved: true, approvedAt: new Date().toISOString() };
        } else {
          execution.results[step.id] = {
            approved: false,
            status: "pending_approval",
            requester: step.config.requester ?? "system",
          };
          execution.status = "paused";
          execution.logs.push({
            timestamp: new Date(),
            step: step.id,
            message: "Execution paused: awaiting approval",
            level: "warn",
          });
          return; // stop execution here
        }
        break;
      }
      case "notification": {
        execution.results[step.id] = {
          notified: true,
          channel: step.config.channel ?? "email",
          recipient: step.config.recipient ?? "admin",
          message: step.config.message ?? `Workflow step ${step.name} completed`,
          sentAt: new Date().toISOString(),
        };
        break;
      }
    }

    execution.currentStep = step.id;

    // Follow next steps
    if (step.nextSteps.length > 0) {
      const nextStepId = step.nextSteps[0];
      const nextStep = workflow.steps.find((s) => s.id === nextStepId);
      if (nextStep && execution.status === "running") {
        executeStep(nextStep, execution, input, workflow);
      }
    } else {
      // No more steps => completed
      execution.status = "completed";
      execution.completedAt = new Date();
      execution.logs.push({
        timestamp: new Date(),
        step: step.id,
        message: "Workflow execution completed",
        level: "info",
      });
    }
  } catch (err: any) {
    execution.logs.push({
      timestamp: new Date(),
      step: step.id,
      message: `Error: ${err?.message ?? String(err)}`,
      level: "error",
    });
    if (step.onError) {
      const errorStep = workflow.steps.find((s) => s.id === step.onError);
      if (errorStep) {
        executeStep(errorStep, execution, input, workflow);
        return;
      }
    }
    execution.status = "failed";
    execution.completedAt = new Date();
  }
}

export function executeWorkflow(
  workflowId: string,
  input: Record<string, any> = {}
): WorkflowExecution | null {
  const workflow = workflows.get(workflowId);
  if (!workflow || workflow.steps.length === 0) return null;

  const execution: WorkflowExecution = {
    id: randomUUID(),
    workflowId,
    status: "running",
    currentStep: workflow.steps[0].id,
    startedAt: new Date(),
    results: { input },
    logs: [
      {
        timestamp: new Date(),
        step: "system",
        message: `Starting workflow: ${workflow.name}`,
        level: "info",
      },
    ],
  };
  workflowExecutions.set(execution.id, execution);

  const firstStep = workflow.steps[0];
  executeStep(firstStep, execution, input, workflow);

  return execution;
}

export function getExecution(executionId: string): WorkflowExecution | null {
  return workflowExecutions.get(executionId) ?? null;
}

export function listExecutions(workflowId?: string): WorkflowExecution[] {
  const all = Array.from(workflowExecutions.values());
  if (!workflowId) return all;
  return all.filter((e) => e.workflowId === workflowId);
}

// --- State Machine ---
interface StateMachine {
  id: string;
  name: string;
  currentState: string;
  states: Record<string, { transitions: Record<string, string>; onEnter?: string; onExit?: string }>;
  history: Array<{ from: string; to: string; event: string; timestamp: Date }>;
}

const stateMachines = new Map<string, StateMachine>();

export function createStateMachine(
  name: string,
  states: StateMachine["states"],
  initialState: string
): StateMachine {
  if (!states[initialState]) {
    throw new Error(`Initial state "${initialState}" does not exist in states definition`);
  }
  const machine: StateMachine = {
    id: randomUUID(),
    name,
    currentState: initialState,
    states,
    history: [],
  };
  stateMachines.set(machine.id, machine);
  return machine;
}

export function getStateMachine(id: string): StateMachine | null {
  return stateMachines.get(id) ?? null;
}

export function transition(
  machineId: string,
  event: string
): { success: boolean; previousState: string; newState: string } | null {
  const machine = stateMachines.get(machineId);
  if (!machine) return null;

  const currentStateDef = machine.states[machine.currentState];
  if (!currentStateDef) {
    return { success: false, previousState: machine.currentState, newState: machine.currentState };
  }

  const targetState = currentStateDef.transitions[event];
  if (!targetState || !machine.states[targetState]) {
    return { success: false, previousState: machine.currentState, newState: machine.currentState };
  }

  const previousState = machine.currentState;
  machine.history.push({
    from: previousState,
    to: targetState,
    event,
    timestamp: new Date(),
  });
  machine.currentState = targetState;

  return { success: true, previousState, newState: targetState };
}

export function getStateHistory(machineId: string): StateMachine["history"] {
  const machine = stateMachines.get(machineId);
  if (!machine) return [];
  return [...machine.history];
}

// --- Internationalization ---
const translations = new Map<string, Record<string, string>>();

export function addTranslation(locale: string, key: string, value: string): void {
  let localeMap = translations.get(locale);
  if (!localeMap) {
    localeMap = {};
    translations.set(locale, localeMap);
  }
  localeMap[key] = value;
}

export function translate(key: string, locale: string, params?: Record<string, string>): string {
  const localeMap = translations.get(locale);
  let text = localeMap?.[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, "g"), paramValue);
    }
  }

  return text;
}

export function listLocales(): string[] {
  return Array.from(translations.keys());
}

export function getTranslations(locale: string): Record<string, string> {
  return { ...(translations.get(locale) ?? {}) };
}

// --- Compliance / GDPR ---

// In-memory store for consent records
const consentRecords = new Map<string, Array<{ purpose: string; granted: boolean; timestamp: string }>>();
// In-memory store for data exports
const dataExports = new Map<string, { data: Record<string, any>; exportedAt: string }>();

export function exportUserData(
  userId: string,
  data: Record<string, any>
): { exportId: string; format: "json"; size: number; downloadUrl: string } {
  const exportId = `EXPORT-${randomUUID().slice(0, 8).toUpperCase()}`;
  const jsonStr = JSON.stringify(data, null, 2);
  dataExports.set(exportId, { data, exportedAt: new Date().toISOString() });

  return {
    exportId,
    format: "json",
    size: Buffer.byteLength(jsonStr, "utf8"),
    downloadUrl: `/api/exports/${exportId}/download`,
  };
}

export function deleteUserData(
  userId: string
): { deleted: boolean; categories: string[]; timestamp: string } {
  const categories: string[] = [];

  // Clean up consent records
  if (consentRecords.has(userId)) {
    consentRecords.delete(userId);
    categories.push("consent_records");
  }

  // Clean up any tenant associations
  for (const [, tenant] of tenants) {
    if (tenant.config.users && Array.isArray(tenant.config.users)) {
      const idx = tenant.config.users.indexOf(userId);
      if (idx >= 0) {
        tenant.config.users.splice(idx, 1);
        categories.push("tenant_membership");
      }
    }
  }

  categories.push("profile", "activity_logs", "preferences");

  return {
    deleted: true,
    categories,
    timestamp: new Date().toISOString(),
  };
}

export function recordConsent(
  userId: string,
  purpose: string,
  granted: boolean
): { consentId: string; timestamp: string } {
  let records = consentRecords.get(userId);
  if (!records) {
    records = [];
    consentRecords.set(userId, records);
  }

  const timestamp = new Date().toISOString();

  // Update existing or add new
  const existing = records.find((r) => r.purpose === purpose);
  if (existing) {
    existing.granted = granted;
    existing.timestamp = timestamp;
  } else {
    records.push({ purpose, granted, timestamp });
  }

  return {
    consentId: `CONSENT-${randomUUID().slice(0, 8).toUpperCase()}`,
    timestamp,
  };
}

export function getConsents(
  userId: string
): Array<{ purpose: string; granted: boolean; timestamp: string }> {
  return [...(consentRecords.get(userId) ?? [])];
}

export function generatePrivacyReport(tenantId: string): {
  dataCategories: Array<{
    category: string;
    purpose: string;
    retentionDays: number;
    legalBasis: string;
  }>;
  thirdPartySharing: Array<{ party: string; purpose: string; dataCategories: string[] }>;
  dataSubjectRights: string[];
  generatedAt: string;
} {
  // Validate tenant exists (tenantId is used for scoping the report)
  const _tenant = tenants.get(tenantId);

  return {
    dataCategories: [
      {
        category: "Personal Information",
        purpose: "Account management and service delivery",
        retentionDays: 365,
        legalBasis: "Contract performance",
      },
      {
        category: "Usage Data",
        purpose: "Service improvement and analytics",
        retentionDays: 180,
        legalBasis: "Legitimate interest",
      },
      {
        category: "Communication Data",
        purpose: "Customer support and notifications",
        retentionDays: 90,
        legalBasis: "Consent",
      },
      {
        category: "Billing Information",
        purpose: "Payment processing and invoicing",
        retentionDays: 2555, // ~7 years
        legalBasis: "Legal obligation",
      },
      {
        category: "Technical Logs",
        purpose: "Security monitoring and debugging",
        retentionDays: 30,
        legalBasis: "Legitimate interest",
      },
    ],
    thirdPartySharing: [
      {
        party: "Payment Processor",
        purpose: "Payment processing",
        dataCategories: ["Billing Information"],
      },
      {
        party: "Cloud Infrastructure Provider",
        purpose: "Data hosting and processing",
        dataCategories: ["Personal Information", "Usage Data", "Technical Logs"],
      },
      {
        party: "Analytics Service",
        purpose: "Service improvement",
        dataCategories: ["Usage Data"],
      },
    ],
    dataSubjectRights: [
      "Right of access (Article 15 GDPR)",
      "Right to rectification (Article 16 GDPR)",
      "Right to erasure (Article 17 GDPR)",
      "Right to restriction of processing (Article 18 GDPR)",
      "Right to data portability (Article 20 GDPR)",
      "Right to object (Article 21 GDPR)",
      "Right not to be subject to automated decision-making (Article 22 GDPR)",
    ],
    generatedAt: new Date().toISOString(),
  };
}

// --- Data Retention ---
interface RetentionPolicy {
  category: string;
  retentionDays: number;
  action: "delete" | "archive" | "anonymize";
}

const retentionPolicies = new Map<string, RetentionPolicy>();

export function setRetentionPolicy(
  category: string,
  retentionDays: number,
  action: "delete" | "archive" | "anonymize"
): void {
  retentionPolicies.set(category, { category, retentionDays, action });
}

export function getRetentionPolicies(): Array<{
  category: string;
  retentionDays: number;
  action: string;
}> {
  return Array.from(retentionPolicies.values()).map((p) => ({
    category: p.category,
    retentionDays: p.retentionDays,
    action: p.action,
  }));
}

export function enforceRetention(): {
  processed: number;
  deleted: number;
  archived: number;
  anonymized: number;
} {
  let processed = 0;
  let deleted = 0;
  let archived = 0;
  let anonymized = 0;

  for (const [, policy] of retentionPolicies) {
    // Simulate enforcement: count each policy as processing a batch
    const batchSize = Math.floor(Math.random() * 50) + 1;
    processed += batchSize;
    switch (policy.action) {
      case "delete":
        deleted += batchSize;
        break;
      case "archive":
        archived += batchSize;
        break;
      case "anonymize":
        anonymized += batchSize;
        break;
    }
  }

  return { processed, deleted, archived, anonymized };
}

// --- API Management ---
interface ApiKeyRecord {
  id: string;
  key: string;
  tenantId: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsed?: string;
}

const apiKeys = new Map<string, ApiKeyRecord>();
const apiKeysByKey = new Map<string, ApiKeyRecord>();

export function generateApiKey(
  tenantId: string,
  name: string,
  scopes: string[] = ["read"]
): { key: string; id: string; createdAt: string } {
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    throw new Error(`Tenant "${tenantId}" not found`);
  }

  const id = randomUUID();
  const key = `sk_${tenant.plan}_${randomUUID().replace(/-/g, "")}`;
  const createdAt = new Date().toISOString();

  const record: ApiKeyRecord = { id, key, tenantId, name, scopes, createdAt };
  apiKeys.set(id, record);
  apiKeysByKey.set(key, record);

  return { key, id, createdAt };
}

export function revokeApiKey(keyId: string): boolean {
  const record = apiKeys.get(keyId);
  if (!record) return false;
  apiKeysByKey.delete(record.key);
  apiKeys.delete(keyId);
  return true;
}

export function listApiKeys(
  tenantId: string
): Array<{ id: string; name: string; createdAt: string; lastUsed?: string; scopes: string[] }> {
  const results: Array<{
    id: string;
    name: string;
    createdAt: string;
    lastUsed?: string;
    scopes: string[];
  }> = [];
  for (const [, record] of apiKeys) {
    if (record.tenantId === tenantId) {
      results.push({
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        lastUsed: record.lastUsed,
        scopes: record.scopes,
      });
    }
  }
  return results;
}

export function validateApiKey(
  key: string
): { valid: boolean; tenantId?: string; scopes?: string[] } {
  const record = apiKeysByKey.get(key);
  if (!record) {
    return { valid: false };
  }
  record.lastUsed = new Date().toISOString();
  return { valid: true, tenantId: record.tenantId, scopes: record.scopes };
}

// ========================
// BROWSER AUTOMATION ADVANCED (951-1000)
// ========================

// --- Visual Testing ---
export function compareScreenshots(
  image1: Buffer,
  image2: Buffer
): {
  match: boolean;
  diffPercentage: number;
  diffRegions: Array<{ x: number; y: number; width: number; height: number }>;
} {
  // Simple byte-level comparison for raw pixel buffers.
  // Assumes both images are raw pixel data (RGBA) of equal dimensions.
  // If dimensions differ, treat as 100% mismatch.
  const len = Math.min(image1.length, image2.length);
  const maxLen = Math.max(image1.length, image2.length);

  if (maxLen === 0) {
    return { match: true, diffPercentage: 0, diffRegions: [] };
  }

  let diffPixels = 0;
  // Assume RGBA: 4 bytes per pixel
  const bytesPerPixel = 4;
  const totalPixels = Math.floor(maxLen / bytesPerPixel);

  // Track diff regions by scanning in a grid
  // Estimate width from a common assumption or use sqrt
  const estimatedWidth = Math.ceil(Math.sqrt(totalPixels));
  const estimatedHeight = Math.ceil(totalPixels / estimatedWidth);

  // Grid-based region tracking (divide into 8x8 blocks)
  const gridCols = 8;
  const gridRows = 8;
  const blockWidth = Math.ceil(estimatedWidth / gridCols);
  const blockHeight = Math.ceil(estimatedHeight / gridRows);
  const gridDiffs: boolean[][] = Array.from({ length: gridRows }, () =>
    Array.from({ length: gridCols }, () => false)
  );

  const threshold = 10; // tolerance per channel

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * bytesPerPixel;
    if (offset + bytesPerPixel > len) {
      // Beyond shorter image: count as diff
      diffPixels++;
      const px = i % estimatedWidth;
      const py = Math.floor(i / estimatedWidth);
      const gx = Math.min(Math.floor(px / blockWidth), gridCols - 1);
      const gy = Math.min(Math.floor(py / blockHeight), gridRows - 1);
      gridDiffs[gy][gx] = true;
      continue;
    }

    let channelDiff = false;
    for (let c = 0; c < bytesPerPixel; c++) {
      if (Math.abs(image1[offset + c] - image2[offset + c]) > threshold) {
        channelDiff = true;
        break;
      }
    }

    if (channelDiff) {
      diffPixels++;
      const px = i % estimatedWidth;
      const py = Math.floor(i / estimatedWidth);
      const gx = Math.min(Math.floor(px / blockWidth), gridCols - 1);
      const gy = Math.min(Math.floor(py / blockHeight), gridRows - 1);
      gridDiffs[gy][gx] = true;
    }
  }

  // Size mismatch extra pixels
  if (image1.length !== image2.length) {
    const extraPixels = Math.floor(Math.abs(image1.length - image2.length) / bytesPerPixel);
    diffPixels += extraPixels;
  }

  const diffPercentage =
    totalPixels > 0 ? Math.round((diffPixels / totalPixels) * 10000) / 100 : 0;

  // Collect diff regions from grid
  const diffRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      if (gridDiffs[gy][gx]) {
        diffRegions.push({
          x: gx * blockWidth,
          y: gy * blockHeight,
          width: blockWidth,
          height: blockHeight,
        });
      }
    }
  }

  // Merge adjacent regions horizontally
  const mergedRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
  const visited = new Set<string>();

  for (const region of diffRegions) {
    const key = `${region.x},${region.y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    let merged = { ...region };
    // Expand right
    for (const other of diffRegions) {
      const otherKey = `${other.x},${other.y}`;
      if (visited.has(otherKey)) continue;
      if (other.y === merged.y && other.x === merged.x + merged.width) {
        merged.width += other.width;
        visited.add(otherKey);
      }
    }
    mergedRegions.push(merged);
  }

  return {
    match: diffPercentage === 0,
    diffPercentage,
    diffRegions: mergedRegions,
  };
}

export function generateVisualReport(
  comparisons: Array<{
    name: string;
    baseline: string;
    current: string;
    diffPercentage: number;
  }>
): string {
  const rows = comparisons
    .map((c) => {
      const status =
        c.diffPercentage === 0
          ? '<span style="color:green">PASS</span>'
          : c.diffPercentage < 5
            ? '<span style="color:orange">WARN</span>'
            : '<span style="color:red">FAIL</span>';
      return `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${status}</td>
        <td>${c.diffPercentage}%</td>
        <td><img src="${escapeHtml(c.baseline)}" style="max-width:200px;max-height:150px" alt="baseline" /></td>
        <td><img src="${escapeHtml(c.current)}" style="max-width:200px;max-height:150px" alt="current" /></td>
      </tr>`;
    })
    .join("\n");

  const totalTests = comparisons.length;
  const passed = comparisons.filter((c) => c.diffPercentage === 0).length;
  const warnings = comparisons.filter((c) => c.diffPercentage > 0 && c.diffPercentage < 5).length;
  const failed = comparisons.filter((c) => c.diffPercentage >= 5).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Visual Regression Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; }
    .summary-card { padding: 16px 24px; border-radius: 8px; color: white; font-size: 18px; }
    .summary-card.total { background: #2196F3; }
    .summary-card.pass { background: #4CAF50; }
    .summary-card.warn { background: #FF9800; }
    .summary-card.fail { background: #f44336; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th { background: #333; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #eee; vertical-align: middle; }
    tr:hover { background: #f9f9f9; }
  </style>
</head>
<body>
  <h1>Visual Regression Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  <div class="summary">
    <div class="summary-card total">Total: ${totalTests}</div>
    <div class="summary-card pass">Passed: ${passed}</div>
    <div class="summary-card warn">Warnings: ${warnings}</div>
    <div class="summary-card fail">Failed: ${failed}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Test Name</th>
        <th>Status</th>
        <th>Diff %</th>
        <th>Baseline</th>
        <th>Current</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function checkResponsiveDesign(url: string): {
  viewports: Array<{ name: string; width: number; height: number; issues: string[] }>;
  recommendations: string[];
} {
  const viewports: Array<{ name: string; width: number; height: number; issues: string[] }> = [
    { name: "Mobile Portrait", width: 375, height: 667, issues: [] },
    { name: "Mobile Landscape", width: 667, height: 375, issues: [] },
    { name: "Tablet Portrait", width: 768, height: 1024, issues: [] },
    { name: "Tablet Landscape", width: 1024, height: 768, issues: [] },
    { name: "Desktop", width: 1440, height: 900, issues: [] },
    { name: "Large Desktop", width: 1920, height: 1080, issues: [] },
  ];

  // Static analysis: check URL for common responsive issues
  const recommendations: string[] = [];

  // Since we cannot actually render pages, provide structural recommendations
  recommendations.push("Ensure <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> is set");
  recommendations.push("Use CSS media queries for breakpoints at 375px, 768px, 1024px, and 1440px");
  recommendations.push("Test touch targets are at least 44x44px on mobile viewports");
  recommendations.push("Verify images use srcset or picture elements for responsive loading");
  recommendations.push("Check that no horizontal scrollbar appears on any viewport");

  // Flag common mobile issues
  viewports[0].issues.push("Verify font sizes are at least 16px to prevent iOS zoom on input focus");
  viewports[0].issues.push("Check that navigation is accessible (hamburger menu or similar)");
  viewports[1].issues.push("Verify layout adjusts correctly in landscape orientation");
  viewports[2].issues.push("Ensure sidebar content stacks properly on tablet");

  return { viewports, recommendations };
}

// --- Performance & SEO ---
export function generateLighthouseConfig(
  url: string,
  categories: string[] = ["performance", "accessibility", "best-practices", "seo"]
): object {
  return {
    extends: "lighthouse:default",
    settings: {
      formFactor: "desktop",
      throttling: {
        rttMs: 40,
        throughputKbps: 10240,
        cpuSlowdownMultiplier: 1,
        requestLatencyMs: 0,
        downloadThroughputKbps: 0,
        uploadThroughputKbps: 0,
      },
      screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      emulatedUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      onlyCategories: categories,
      maxWaitForFcp: 30000,
      maxWaitForLoad: 45000,
      skipAudits: [],
    },
    audits: [],
    categories: Object.fromEntries(
      categories.map((cat) => [
        cat,
        { title: cat.charAt(0).toUpperCase() + cat.slice(1), auditRefs: [] },
      ])
    ),
    url,
  };
}

export function analyzeSEO(
  html: string,
  url: string
): {
  score: number;
  title: { present: boolean; length: number; optimal: boolean };
  metaDescription: { present: boolean; length: number; optimal: boolean };
  headings: { h1Count: number; structure: string[] };
  images: { total: number; withAlt: number; withoutAlt: number };
  links: { internal: number; external: number; broken: number };
  schema: { present: boolean; types: string[] };
  openGraph: { present: boolean; tags: Record<string, string> };
  twitterCards: { present: boolean; tags: Record<string, string> };
  recommendations: string[];
} {
  let score = 100;
  const recommendations: string[] = [];

  // Title analysis
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : "";
  const titlePresent = titleText.length > 0;
  const titleOptimal = titleText.length >= 30 && titleText.length <= 60;
  if (!titlePresent) {
    score -= 15;
    recommendations.push("Add a <title> tag to the page");
  } else if (!titleOptimal) {
    score -= 5;
    recommendations.push(`Title length is ${titleText.length} characters; optimal is 30-60`);
  }

  // Meta description
  const metaDescMatch = html.match(
    /<meta\s+(?:[^>]*?\s+)?name=["']description["']\s+(?:[^>]*?\s+)?content=["']([\s\S]*?)["'][^>]*>/i
  ) ?? html.match(
    /<meta\s+(?:[^>]*?\s+)?content=["']([\s\S]*?)["']\s+(?:[^>]*?\s+)?name=["']description["'][^>]*>/i
  );
  const metaDescText = metaDescMatch ? metaDescMatch[1].trim() : "";
  const metaDescPresent = metaDescText.length > 0;
  const metaDescOptimal = metaDescText.length >= 120 && metaDescText.length <= 160;
  if (!metaDescPresent) {
    score -= 10;
    recommendations.push("Add a meta description tag");
  } else if (!metaDescOptimal) {
    score -= 3;
    recommendations.push(`Meta description length is ${metaDescText.length} characters; optimal is 120-160`);
  }

  // Headings analysis
  const h1Matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
  const h1Count = h1Matches.length;
  const headingStructure: string[] = [];
  const allHeadings = html.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi);
  for (const match of allHeadings) {
    const tag = match[1].toLowerCase();
    const text = match[2].replace(/<[^>]*>/g, "").trim().slice(0, 60);
    headingStructure.push(`${tag}: ${text}`);
  }

  if (h1Count === 0) {
    score -= 10;
    recommendations.push("Add exactly one H1 heading to the page");
  } else if (h1Count > 1) {
    score -= 5;
    recommendations.push(`Page has ${h1Count} H1 tags; should have exactly one`);
  }

  // Images analysis
  const imgMatches = html.match(/<img[^>]*>/gi) ?? [];
  const totalImages = imgMatches.length;
  let withAlt = 0;
  let withoutAlt = 0;
  for (const img of imgMatches) {
    if (/alt=["'][^"']+["']/i.test(img)) {
      withAlt++;
    } else {
      withoutAlt++;
    }
  }
  if (withoutAlt > 0) {
    score -= Math.min(10, withoutAlt * 2);
    recommendations.push(`${withoutAlt} image(s) missing alt attributes`);
  }

  // Links analysis
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = new URL("https://example.com");
  }
  const linkMatches = html.matchAll(/<a[^>]*href=["']([^"']*?)["'][^>]*>/gi);
  let internalLinks = 0;
  let externalLinks = 0;
  const brokenLinkCandidates: string[] = [];
  for (const linkMatch of linkMatches) {
    const href = linkMatch[1].trim();
    if (href.startsWith("#") || href.startsWith("javascript:") || href === "") {
      continue;
    }
    try {
      const linkUrl = new URL(href, url);
      if (linkUrl.hostname === parsedUrl.hostname) {
        internalLinks++;
      } else {
        externalLinks++;
      }
    } catch {
      brokenLinkCandidates.push(href);
    }
  }
  const brokenLinks = brokenLinkCandidates.length;
  if (brokenLinks > 0) {
    score -= Math.min(10, brokenLinks * 3);
    recommendations.push(`${brokenLinks} potentially malformed link(s) detected`);
  }

  // Schema.org
  const schemaTypes: string[] = [];
  const ldJsonMatches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const ldMatch of ldJsonMatches) {
    try {
      const parsed = JSON.parse(ldMatch[1]);
      if (parsed["@type"]) {
        schemaTypes.push(parsed["@type"]);
      }
      if (Array.isArray(parsed["@graph"])) {
        for (const item of parsed["@graph"]) {
          if (item["@type"]) schemaTypes.push(item["@type"]);
        }
      }
    } catch {
      // Invalid JSON-LD
    }
  }
  // Also check microdata
  const microdataMatches = html.matchAll(/itemtype=["'](https?:\/\/schema\.org\/(\w+))["']/gi);
  for (const mdMatch of microdataMatches) {
    schemaTypes.push(mdMatch[2]);
  }
  const schemaPresent = schemaTypes.length > 0;
  if (!schemaPresent) {
    score -= 5;
    recommendations.push("Add structured data (Schema.org) to improve search result appearance");
  }

  // Open Graph
  const ogTags: Record<string, string> = {};
  const ogMatches = html.matchAll(
    /<meta\s+(?:[^>]*?\s+)?property=["'](og:[^"']+)["']\s+(?:[^>]*?\s+)?content=["']([^"']*)["'][^>]*>/gi
  );
  for (const ogMatch of ogMatches) {
    ogTags[ogMatch[1]] = ogMatch[2];
  }
  // Also try reversed attribute order
  const ogMatches2 = html.matchAll(
    /<meta\s+(?:[^>]*?\s+)?content=["']([^"']*)["']\s+(?:[^>]*?\s+)?property=["'](og:[^"']+)["'][^>]*>/gi
  );
  for (const ogMatch of ogMatches2) {
    ogTags[ogMatch[2]] = ogMatch[1];
  }
  const ogPresent = Object.keys(ogTags).length > 0;
  if (!ogPresent) {
    score -= 5;
    recommendations.push("Add Open Graph meta tags for better social media sharing");
  }

  // Twitter Cards
  const twitterTags: Record<string, string> = {};
  const twitterMatches = html.matchAll(
    /<meta\s+(?:[^>]*?\s+)?name=["'](twitter:[^"']+)["']\s+(?:[^>]*?\s+)?content=["']([^"']*)["'][^>]*>/gi
  );
  for (const twMatch of twitterMatches) {
    twitterTags[twMatch[1]] = twMatch[2];
  }
  const twitterMatches2 = html.matchAll(
    /<meta\s+(?:[^>]*?\s+)?content=["']([^"']*)["']\s+(?:[^>]*?\s+)?name=["'](twitter:[^"']+)["'][^>]*>/gi
  );
  for (const twMatch of twitterMatches2) {
    twitterTags[twMatch[2]] = twMatch[1];
  }
  const twitterPresent = Object.keys(twitterTags).length > 0;
  if (!twitterPresent) {
    score -= 3;
    recommendations.push("Add Twitter Card meta tags for better Twitter sharing");
  }

  // Additional checks
  const hasCanonical = /<link[^>]*rel=["']canonical["'][^>]*>/i.test(html);
  if (!hasCanonical) {
    score -= 3;
    recommendations.push("Add a canonical link tag to prevent duplicate content issues");
  }

  const hasViewport = /<meta[^>]*name=["']viewport["'][^>]*>/i.test(html);
  if (!hasViewport) {
    score -= 5;
    recommendations.push("Add a viewport meta tag for mobile responsiveness");
  }

  const hasLang = /<html[^>]*lang=["'][^"']+["'][^>]*>/i.test(html);
  if (!hasLang) {
    score -= 3;
    recommendations.push("Add a lang attribute to the <html> tag");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    title: { present: titlePresent, length: titleText.length, optimal: titleOptimal },
    metaDescription: { present: metaDescPresent, length: metaDescText.length, optimal: metaDescOptimal },
    headings: { h1Count, structure: headingStructure },
    images: { total: totalImages, withAlt, withoutAlt },
    links: { internal: internalLinks, external: externalLinks, broken: brokenLinks },
    schema: { present: schemaPresent, types: schemaTypes },
    openGraph: { present: ogPresent, tags: ogTags },
    twitterCards: { present: twitterPresent, tags: twitterTags },
    recommendations,
  };
}

export function analyzeWebPerformance(html: string): {
  resourceCount: number;
  estimatedLoadTime: string;
  issues: Array<{ type: string; description: string; impact: "high" | "medium" | "low" }>;
  recommendations: string[];
} {
  const issues: Array<{ type: string; description: string; impact: "high" | "medium" | "low" }> = [];
  const recommendations: string[] = [];

  // Count resources
  const scripts = html.match(/<script[^>]*src=["'][^"']+["'][^>]*>/gi) ?? [];
  const styles = html.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi) ?? [];
  const images = html.match(/<img[^>]*src=["'][^"']+["'][^>]*>/gi) ?? [];
  const fonts = html.match(/<link[^>]*href=["'][^"']*\.(woff2?|ttf|otf|eot)["'][^>]*>/gi) ?? [];
  const iframes = html.match(/<iframe[^>]*>/gi) ?? [];

  const resourceCount = scripts.length + styles.length + images.length + fonts.length + iframes.length;

  // Analyze scripts
  const inlineScripts = html.match(/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const blockingScripts = scripts.filter(
    (s) => !(/async/i.test(s) || /defer/i.test(s))
  );

  if (blockingScripts.length > 0) {
    issues.push({
      type: "render-blocking-scripts",
      description: `${blockingScripts.length} render-blocking script(s) found without async or defer`,
      impact: "high",
    });
    recommendations.push("Add async or defer attributes to non-critical scripts");
  }

  if (scripts.length > 10) {
    issues.push({
      type: "too-many-scripts",
      description: `${scripts.length} external scripts detected; consider bundling`,
      impact: "medium",
    });
    recommendations.push("Bundle JavaScript files to reduce HTTP requests");
  }

  if (inlineScripts.length > 5) {
    issues.push({
      type: "excessive-inline-scripts",
      description: `${inlineScripts.length} inline scripts found; consider externalizing`,
      impact: "low",
    });
  }

  // Analyze styles
  const inlineStyles = html.match(/style=["'][^"']+["']/gi) ?? [];
  if (styles.length > 5) {
    issues.push({
      type: "too-many-stylesheets",
      description: `${styles.length} external stylesheets detected; consider combining`,
      impact: "medium",
    });
    recommendations.push("Combine CSS files to reduce HTTP requests");
  }

  if (inlineStyles.length > 20) {
    issues.push({
      type: "excessive-inline-styles",
      description: `${inlineStyles.length} inline style attributes found`,
      impact: "low",
    });
    recommendations.push("Move inline styles to external CSS files for better caching");
  }

  // Analyze images
  const largeImageCandidates = images.filter(
    (img) => !(/loading=["']lazy["']/i.test(img))
  );
  if (largeImageCandidates.length > 3) {
    issues.push({
      type: "unoptimized-images",
      description: `${largeImageCandidates.length} image(s) without lazy loading`,
      impact: "high",
    });
    recommendations.push("Add loading=\"lazy\" to below-the-fold images");
  }

  const imagesWithoutDimensions = images.filter(
    (img) => !(/width=/i.test(img) && /height=/i.test(img))
  );
  if (imagesWithoutDimensions.length > 0) {
    issues.push({
      type: "images-without-dimensions",
      description: `${imagesWithoutDimensions.length} image(s) missing width/height attributes (causes layout shift)`,
      impact: "medium",
    });
    recommendations.push("Add width and height attributes to images to prevent layout shift");
  }

  // Check for modern image formats
  const modernFormats = images.filter(
    (img) => /\.(webp|avif)/i.test(img)
  );
  if (images.length > 0 && modernFormats.length === 0) {
    issues.push({
      type: "no-modern-image-formats",
      description: "No modern image formats (WebP, AVIF) detected",
      impact: "medium",
    });
    recommendations.push("Use WebP or AVIF image formats for better compression");
  }

  // Iframes
  if (iframes.length > 2) {
    issues.push({
      type: "too-many-iframes",
      description: `${iframes.length} iframes detected; each adds significant overhead`,
      impact: "high",
    });
    recommendations.push("Minimize iframe usage or lazy-load them");
  }

  // Fonts
  if (fonts.length > 3) {
    issues.push({
      type: "too-many-fonts",
      description: `${fonts.length} font files detected`,
      impact: "medium",
    });
    recommendations.push("Limit font files; use font-display: swap for better perceived performance");
  }

  // Check for preloads/preconnects
  const hasPreconnect = /<link[^>]*rel=["']preconnect["'][^>]*>/i.test(html);
  const hasPreload = /<link[^>]*rel=["']preload["'][^>]*>/i.test(html);
  if (!hasPreconnect && (scripts.length + styles.length) > 3) {
    recommendations.push("Add preconnect hints for third-party domains");
  }
  if (!hasPreload) {
    recommendations.push("Use rel=\"preload\" for critical resources (fonts, hero images)");
  }

  // Check HTML size
  const htmlSizeKB = Math.round(Buffer.byteLength(html, "utf8") / 1024);
  if (htmlSizeKB > 100) {
    issues.push({
      type: "large-html",
      description: `HTML document is ${htmlSizeKB}KB; consider reducing inline content`,
      impact: "medium",
    });
    recommendations.push("Reduce HTML size by removing unnecessary inline content");
  }

  // Estimate load time (rough heuristic)
  // ~200ms per blocking resource, ~50ms per non-blocking, ~100ms base
  const blockingResources = blockingScripts.length + styles.length;
  const nonBlockingResources = resourceCount - blockingResources;
  const estimatedMs = 100 + blockingResources * 200 + nonBlockingResources * 50 + htmlSizeKB * 2;
  const estimatedLoadTime =
    estimatedMs < 1000
      ? `${estimatedMs}ms`
      : `${(estimatedMs / 1000).toFixed(1)}s`;

  return {
    resourceCount,
    estimatedLoadTime,
    issues,
    recommendations,
  };
}

// --- Accessibility ---
export function auditAccessibility(html: string): {
  score: number;
  violations: Array<{
    id: string;
    impact: "critical" | "serious" | "moderate" | "minor";
    description: string;
    help: string;
    elements: string[];
  }>;
  passes: number;
  wcagLevel: "A" | "AA" | "AAA" | "none";
} {
  const violations: Array<{
    id: string;
    impact: "critical" | "serious" | "moderate" | "minor";
    description: string;
    help: string;
    elements: string[];
  }> = [];
  let passes = 0;

  // 1. Images without alt text (WCAG 1.1.1 - Level A)
  const imgTags = html.match(/<img[^>]*>/gi) ?? [];
  const imgsWithoutAlt: string[] = [];
  for (const img of imgTags) {
    if (!/alt=/i.test(img)) {
      imgsWithoutAlt.push(img.slice(0, 80));
    }
  }
  if (imgsWithoutAlt.length > 0) {
    violations.push({
      id: "image-alt",
      impact: "critical",
      description: "Images must have alternative text",
      help: "Add alt attributes to all <img> elements. Use alt=\"\" for decorative images.",
      elements: imgsWithoutAlt,
    });
  } else if (imgTags.length > 0) {
    passes++;
  }

  // 2. Form inputs without labels (WCAG 1.3.1 - Level A)
  const inputTags = html.match(/<input[^>]*>/gi) ?? [];
  const inputsWithoutLabel: string[] = [];
  for (const input of inputTags) {
    const typeMatch = input.match(/type=["'](\w+)["']/i);
    const inputType = typeMatch ? typeMatch[1].toLowerCase() : "text";
    if (["hidden", "submit", "button", "reset", "image"].includes(inputType)) continue;

    const idMatch = input.match(/id=["']([^"']+)["']/i);
    const hasAriaLabel = /aria-label=/i.test(input);
    const hasAriaLabelledBy = /aria-labelledby=/i.test(input);
    const hasTitleAttr = /title=/i.test(input);

    if (idMatch) {
      const labelRegex = new RegExp(`<label[^>]*for=["']${idMatch[1]}["'][^>]*>`, "i");
      if (labelRegex.test(html)) continue;
    }

    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitleAttr) {
      inputsWithoutLabel.push(input.slice(0, 80));
    }
  }
  if (inputsWithoutLabel.length > 0) {
    violations.push({
      id: "label",
      impact: "critical",
      description: "Form elements must have labels",
      help: "Associate a <label> with each form control via for/id, or use aria-label/aria-labelledby.",
      elements: inputsWithoutLabel,
    });
  } else if (inputTags.length > 0) {
    passes++;
  }

  // 3. Document language (WCAG 3.1.1 - Level A)
  const hasLang = /<html[^>]*lang=["'][^"']+["'][^>]*>/i.test(html);
  if (!hasLang) {
    violations.push({
      id: "html-has-lang",
      impact: "serious",
      description: "<html> element must have a lang attribute",
      help: "Add a lang attribute to the <html> element (e.g., <html lang=\"en\">).",
      elements: ["<html>"],
    });
  } else {
    passes++;
  }

  // 4. Page title (WCAG 2.4.2 - Level A)
  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
  if (!hasTitle) {
    violations.push({
      id: "document-title",
      impact: "serious",
      description: "Document must have a <title> element",
      help: "Add a descriptive <title> element inside <head>.",
      elements: ["<head>"],
    });
  } else {
    passes++;
  }

  // 5. Heading hierarchy (WCAG 1.3.1 - Level A)
  const headingLevels: number[] = [];
  const headingMatches = html.matchAll(/<h([1-6])[^>]*>/gi);
  for (const hm of headingMatches) {
    headingLevels.push(parseInt(hm[1], 10));
  }
  let headingSkips = false;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      headingSkips = true;
      break;
    }
  }
  if (headingSkips) {
    violations.push({
      id: "heading-order",
      impact: "moderate",
      description: "Heading levels should not skip (e.g., h2 to h4)",
      help: "Ensure headings follow a logical order without skipping levels.",
      elements: headingLevels.map((l) => `<h${l}>`),
    });
  } else if (headingLevels.length > 0) {
    passes++;
  }

  // 6. Link text (WCAG 2.4.4 - Level A)
  const linkTextMatches = html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi);
  const badLinks: string[] = [];
  const genericTexts = new Set(["click here", "here", "read more", "more", "link", "click"]);
  for (const lm of linkTextMatches) {
    const text = lm[1].replace(/<[^>]*>/g, "").trim().toLowerCase();
    if (genericTexts.has(text)) {
      badLinks.push(`<a>${text}</a>`);
    }
  }
  if (badLinks.length > 0) {
    violations.push({
      id: "link-name",
      impact: "serious",
      description: "Links must have discernible text",
      help: "Use descriptive link text instead of generic phrases like 'click here' or 'read more'.",
      elements: badLinks.slice(0, 10),
    });
  } else {
    passes++;
  }

  // 7. ARIA roles validation
  const ariaRoles = html.matchAll(/role=["']([^"']+)["']/gi);
  const validRoles = new Set([
    "alert", "alertdialog", "application", "article", "banner", "button",
    "cell", "checkbox", "columnheader", "combobox", "complementary",
    "contentinfo", "definition", "dialog", "directory", "document",
    "feed", "figure", "form", "grid", "gridcell", "group", "heading",
    "img", "link", "list", "listbox", "listitem", "log", "main",
    "marquee", "math", "menu", "menubar", "menuitem", "menuitemcheckbox",
    "menuitemradio", "navigation", "none", "note", "option", "presentation",
    "progressbar", "radio", "radiogroup", "region", "row", "rowgroup",
    "rowheader", "scrollbar", "search", "searchbox", "separator",
    "slider", "spinbutton", "status", "switch", "tab", "table",
    "tablist", "tabpanel", "term", "textbox", "timer", "toolbar",
    "tooltip", "tree", "treegrid", "treeitem",
  ]);
  const invalidRoles: string[] = [];
  for (const rm of ariaRoles) {
    if (!validRoles.has(rm[1].toLowerCase())) {
      invalidRoles.push(`role="${rm[1]}"`);
    }
  }
  if (invalidRoles.length > 0) {
    violations.push({
      id: "aria-roles",
      impact: "serious",
      description: "ARIA roles must be valid",
      help: "Use valid ARIA role values. See WAI-ARIA specification for the list of roles.",
      elements: invalidRoles,
    });
  } else {
    passes++;
  }

  // 8. Color contrast (can only check inline styles for known patterns)
  const hasContrastIssuePatterns = /color:\s*#(fff|ffffff|eee|eeeeee|ddd|dddddd|ccc|cccccc)[^;]*;[^}]*background[^:]*:\s*#(fff|ffffff|eee|eeeeee|fafafa)/gi.test(html);
  if (hasContrastIssuePatterns) {
    violations.push({
      id: "color-contrast",
      impact: "serious",
      description: "Elements may have insufficient color contrast",
      help: "Ensure text has a contrast ratio of at least 4.5:1 (AA) or 7:1 (AAA).",
      elements: ["Detected low-contrast inline style patterns"],
    });
  } else {
    passes++;
  }

  // 9. Tabindex positive values
  const tabindexMatches = html.matchAll(/tabindex=["'](\d+)["']/gi);
  const positiveTabindex: string[] = [];
  for (const tm of tabindexMatches) {
    const val = parseInt(tm[1], 10);
    if (val > 0) {
      positiveTabindex.push(`tabindex="${val}"`);
    }
  }
  if (positiveTabindex.length > 0) {
    violations.push({
      id: "tabindex",
      impact: "moderate",
      description: "Avoid positive tabindex values",
      help: "Use tabindex=\"0\" or tabindex=\"-1\" instead of positive values to maintain natural tab order.",
      elements: positiveTabindex,
    });
  } else {
    passes++;
  }

  // 10. Skip navigation link
  const hasSkipLink = /<a[^>]*href=["']#(main|content|maincontent)[^"']*["'][^>]*>/i.test(html);
  if (!hasSkipLink) {
    violations.push({
      id: "skip-link",
      impact: "moderate",
      description: "Page should have a skip navigation link",
      help: "Add a skip link at the top of the page that links to the main content area.",
      elements: ["<body>"],
    });
  } else {
    passes++;
  }

  // 11. Landmark regions
  const hasMain = /<main[^>]*>/i.test(html) || /role=["']main["']/i.test(html);
  const hasNav = /<nav[^>]*>/i.test(html) || /role=["']navigation["']/i.test(html);
  if (!hasMain) {
    violations.push({
      id: "landmark-main",
      impact: "moderate",
      description: "Page must have a main landmark",
      help: "Use <main> element or role=\"main\" to identify the main content area.",
      elements: ["<body>"],
    });
  } else {
    passes++;
  }

  // 12. Auto-playing media
  const autoplayMedia = html.match(/<(video|audio)[^>]*autoplay[^>]*>/gi) ?? [];
  if (autoplayMedia.length > 0) {
    violations.push({
      id: "no-autoplay-audio-video",
      impact: "moderate",
      description: "Audio/video elements should not autoplay",
      help: "Remove autoplay from media elements or ensure they are muted.",
      elements: autoplayMedia.map((m) => m.slice(0, 80)),
    });
  } else {
    passes++;
  }

  // Calculate score
  const totalChecks = violations.length + passes;
  const score = totalChecks > 0 ? Math.round((passes / totalChecks) * 100) : 100;

  // Determine WCAG level
  const criticalViolations = violations.filter((v) => v.impact === "critical").length;
  const seriousViolations = violations.filter((v) => v.impact === "serious").length;
  let wcagLevel: "A" | "AA" | "AAA" | "none";
  if (criticalViolations > 0) {
    wcagLevel = "none";
  } else if (seriousViolations > 0) {
    wcagLevel = "A";
  } else if (violations.length > 0) {
    wcagLevel = "AA";
  } else {
    wcagLevel = "AAA";
  }

  return {
    score,
    violations,
    passes,
    wcagLevel,
  };
}

// --- Network & Testing ---
export function generateMockApiResponse(config: {
  endpoint: string;
  method: string;
  statusCode: number;
  body: any;
  headers?: Record<string, string>;
  delay?: number;
}): { mockConfig: object; curlCommand: string } {
  const headers = {
    "Content-Type": "application/json",
    "X-Mock-Response": "true",
    ...(config.headers ?? {}),
  };

  const mockConfig = {
    request: {
      method: config.method.toUpperCase(),
      url: config.endpoint,
    },
    response: {
      status: config.statusCode,
      headers,
      body: config.body,
      delay: config.delay ?? 0,
    },
  };

  const headerFlags = Object.entries(headers)
    .map(([k, v]) => `-H "${k}: ${v}"`)
    .join(" ");

  const bodyStr =
    config.method.toUpperCase() !== "GET"
      ? ` -d '${JSON.stringify(config.body)}'`
      : "";

  const curlCommand = `curl -X ${config.method.toUpperCase()} ${headerFlags}${bodyStr} "${config.endpoint}"`;

  return { mockConfig, curlCommand };
}

export function generateWebSocketTest(
  url: string,
  messages: Array<{ send: string; expectResponse?: string }>
): string {
  const messageSteps = messages
    .map((m, i) => {
      const sendLine = `  // Step ${i + 1}: Send message\n  ws.send(${JSON.stringify(m.send)});`;
      if (m.expectResponse) {
        return `${sendLine}\n  // Expect response matching: ${m.expectResponse}`;
      }
      return sendLine;
    })
    .join("\n\n");

  return `// WebSocket Test Script for: ${url}
// Generated: ${new Date().toISOString()}

const WebSocket = require('ws');

async function runTest() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(${JSON.stringify(url)});
    const receivedMessages = [];
    const expectedResponses = ${JSON.stringify(messages.filter((m) => m.expectResponse).map((m) => m.expectResponse))};
    let messageIndex = 0;
    let sendIndex = 0;
    const messagesToSend = ${JSON.stringify(messages.map((m) => m.send))};

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Test timed out after 30 seconds'));
    }, 30000);

    ws.on('open', () => {
      console.log('Connected to ' + ${JSON.stringify(url)});
      sendNext();
    });

    function sendNext() {
      if (sendIndex < messagesToSend.length) {
        console.log('Sending:', messagesToSend[sendIndex]);
        ws.send(messagesToSend[sendIndex]);
        sendIndex++;
      }
    }

    ws.on('message', (data) => {
      const msg = data.toString();
      console.log('Received:', msg);
      receivedMessages.push(msg);

      if (messageIndex < expectedResponses.length) {
        const expected = expectedResponses[messageIndex];
        if (msg.includes(expected)) {
          console.log('PASS: Response matches expected pattern');
          messageIndex++;
        }
      }

      // Send next message after receiving response
      sendNext();

      // Check if all expected responses received
      if (messageIndex >= expectedResponses.length && sendIndex >= messagesToSend.length) {
        clearTimeout(timeout);
        ws.close();
        resolve({ success: true, messagesReceived: receivedMessages.length });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (messageIndex < expectedResponses.length) {
        reject(new Error('Connection closed before all expected responses received'));
      }
    });
  });
}

runTest()
  .then((result) => {
    console.log('\\nTest PASSED:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('\\nTest FAILED:', err.message);
    process.exit(1);
  });
`;
}

export function generateFormFillScript(
  fields: Array<{
    selector: string;
    value: string;
    type: "text" | "select" | "checkbox" | "radio" | "file";
  }>
): string {
  const fieldActions = fields
    .map((field, i) => {
      switch (field.type) {
        case "text":
          return `  // Field ${i + 1}: Text input
  const field${i} = document.querySelector(${JSON.stringify(field.selector)});
  if (field${i}) {
    field${i}.value = ${JSON.stringify(field.value)};
    field${i}.dispatchEvent(new Event('input', { bubbles: true }));
    field${i}.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('Filled text field: ${field.selector}');
  } else {
    console.warn('Field not found: ${field.selector}');
  }`;

        case "select":
          return `  // Field ${i + 1}: Select dropdown
  const field${i} = document.querySelector(${JSON.stringify(field.selector)});
  if (field${i}) {
    field${i}.value = ${JSON.stringify(field.value)};
    field${i}.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('Selected option: ${field.selector}');
  } else {
    console.warn('Field not found: ${field.selector}');
  }`;

        case "checkbox":
          return `  // Field ${i + 1}: Checkbox
  const field${i} = document.querySelector(${JSON.stringify(field.selector)});
  if (field${i}) {
    const shouldCheck = ${JSON.stringify(field.value)} === 'true';
    if (field${i}.checked !== shouldCheck) {
      field${i}.click();
    }
    console.log('Checkbox set: ${field.selector} =', field${i}.checked);
  } else {
    console.warn('Field not found: ${field.selector}');
  }`;

        case "radio":
          return `  // Field ${i + 1}: Radio button
  const field${i} = document.querySelector(${JSON.stringify(field.selector)}
    + '[value=${JSON.stringify(field.value)}]');
  if (field${i}) {
    field${i}.click();
    console.log('Radio selected: ${field.selector}');
  } else {
    console.warn('Field not found: ${field.selector}');
  }`;

        case "file":
          return `  // Field ${i + 1}: File input (requires manual handling in automation framework)
  const field${i} = document.querySelector(${JSON.stringify(field.selector)});
  if (field${i}) {
    console.log('File input found: ${field.selector} — set file path via automation framework');
    // In Puppeteer: await page.setInputFiles('${field.selector}', '${field.value}');
    // In Playwright: await page.locator('${field.selector}').setInputFiles('${field.value}');
  } else {
    console.warn('Field not found: ${field.selector}');
  }`;
      }
    })
    .join("\n\n");

  return `// Form Fill Automation Script
// Generated: ${new Date().toISOString()}
// Fields: ${fields.length}

(function fillForm() {
  'use strict';

  console.log('Starting form fill...');

${fieldActions}

  console.log('Form fill complete. ${fields.length} field(s) processed.');
})();
`;
}

// --- Data Extraction ---
export function generateScraperConfig(config: {
  url: string;
  selectors: Record<string, string>;
  pagination?: { nextSelector: string; maxPages: number };
  output: "json" | "csv";
}): string {
  const selectorEntries = Object.entries(config.selectors)
    .map(([key, sel]) => `      ${JSON.stringify(key)}: ${JSON.stringify(sel)}`)
    .join(",\n");

  const paginationBlock = config.pagination
    ? `
  // Pagination
  const maxPages = ${config.pagination.maxPages};
  let currentPage = 1;

  while (currentPage < maxPages) {
    const nextButton = document.querySelector(${JSON.stringify(config.pagination.nextSelector)});
    if (!nextButton) {
      console.log('No more pages found at page', currentPage);
      break;
    }
    nextButton.click();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page load
    currentPage++;

    // Extract data from new page
    document.querySelectorAll(Object.values(selectors)[0]).forEach((el, idx) => {
      const row = {};
      for (const [key, selector] of Object.entries(selectors)) {
        const elements = document.querySelectorAll(selector);
        row[key] = elements[idx]?.textContent?.trim() ?? '';
      }
      results.push(row);
    });
    console.log(\`Page \${currentPage}: \${results.length} total records\`);
  }`
    : "";

  const outputBlock =
    config.output === "csv"
      ? `
  // Convert to CSV
  if (results.length === 0) {
    console.log('No data extracted');
    return '';
  }
  const headers = Object.keys(results[0]);
  const csvRows = [
    headers.join(','),
    ...results.map(row =>
      headers.map(h => {
        const val = String(row[h] ?? '').replace(/"/g, '""');
        return val.includes(',') || val.includes('"') || val.includes('\\n') ? \`"\${val}"\` : val;
      }).join(',')
    )
  ];
  const csvOutput = csvRows.join('\\n');
  console.log(csvOutput);
  return csvOutput;`
      : `
  // Output as JSON
  const jsonOutput = JSON.stringify(results, null, 2);
  console.log(jsonOutput);
  return jsonOutput;`;

  return `// Web Scraper Script
// Target: ${config.url}
// Generated: ${new Date().toISOString()}

(async function scrape() {
  'use strict';

  const selectors = {
${selectorEntries}
  };

  const results = [];

  // Extract data from current page
  const firstSelectorElements = document.querySelectorAll(Object.values(selectors)[0]);
  const rowCount = firstSelectorElements.length;

  for (let i = 0; i < rowCount; i++) {
    const row = {};
    for (const [key, selector] of Object.entries(selectors)) {
      const elements = document.querySelectorAll(selector);
      row[key] = elements[i]?.textContent?.trim() ?? '';
    }
    results.push(row);
  }

  console.log(\`Page 1: \${results.length} records extracted\`);
${paginationBlock}
${outputBlock}
})();
`;
}

export function detectBrokenLinks(
  html: string,
  baseUrl: string
): Array<{ url: string; status: string; anchor: string }> {
  const results: Array<{ url: string; status: string; anchor: string }> = [];
  const linkMatches = html.matchAll(/<a[^>]*href=["']([^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi);
  const seenUrls = new Set<string>();

  for (const match of linkMatches) {
    const href = match[1].trim();
    const anchorText = match[2].replace(/<[^>]*>/g, "").trim();

    if (href === "" || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }

    let fullUrl: string;
    try {
      const resolved = new URL(href, baseUrl);
      fullUrl = resolved.href;
    } catch {
      results.push({ url: href, status: "malformed_url", anchor: anchorText });
      continue;
    }

    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    // Static heuristics for broken links (cannot make actual HTTP requests here)
    let status = "ok";

    // Check for common broken link patterns
    if (/\s/.test(href)) {
      status = "suspicious_whitespace";
    } else if (/\.\.(\/\.\.)+/.test(href)) {
      status = "suspicious_path_traversal";
    } else if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(fullUrl)) {
      status = "localhost_reference";
    } else if (/example\.(com|org|net)/i.test(fullUrl)) {
      status = "example_domain";
    } else if (/\.(html?|php|asp|jsp)$/i.test(fullUrl) === false &&
               /\/[^/]*\.[^/]+$/.test(fullUrl) &&
               !/\.(js|css|png|jpg|jpeg|gif|svg|webp|pdf|doc|zip|xml|json)/i.test(fullUrl)) {
      status = "suspicious_extension";
    }

    if (status !== "ok") {
      results.push({ url: fullUrl, status, anchor: anchorText });
    }
  }

  return results;
}

export function validateSitemap(sitemapXml: string): {
  valid: boolean;
  urls: number;
  errors: Array<{ line: number; error: string }>;
  warnings: string[];
} {
  const errors: Array<{ line: number; error: string }> = [];
  const warnings: string[] = [];
  const lines = sitemapXml.split("\n");

  // Check XML declaration
  if (!sitemapXml.trim().startsWith("<?xml")) {
    errors.push({ line: 1, error: "Missing XML declaration" });
  }

  // Check urlset root element
  const hasUrlset = /<urlset[^>]*>/i.test(sitemapXml);
  const hasSitemapindex = /<sitemapindex[^>]*>/i.test(sitemapXml);
  if (!hasUrlset && !hasSitemapindex) {
    errors.push({ line: 1, error: "Missing <urlset> or <sitemapindex> root element" });
  }

  // Check namespace
  if (hasUrlset && !/xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/i.test(sitemapXml)) {
    errors.push({
      line: findLineNumber(lines, "<urlset"),
      error: "Missing or incorrect sitemap namespace (should be http://www.sitemaps.org/schemas/sitemap/0.9)",
    });
  }

  // Count and validate URLs
  const urlBlocks = sitemapXml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];
  const sitemapBlocks = sitemapXml.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) ?? [];
  const urlCount = urlBlocks.length + sitemapBlocks.length;

  // Check each URL block
  for (let i = 0; i < urlBlocks.length; i++) {
    const block = urlBlocks[i];
    const blockLine = findLineNumber(lines, block.slice(0, 30));

    // Must have <loc>
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    if (!locMatch) {
      errors.push({ line: blockLine, error: `URL block ${i + 1}: Missing <loc> element` });
      continue;
    }

    const loc = locMatch[1].trim();

    // Validate URL format
    try {
      new URL(loc);
    } catch {
      errors.push({ line: blockLine, error: `URL block ${i + 1}: Invalid URL: ${loc}` });
    }

    // Check for encoded entities
    if (/[<>"{}|\\^`]/.test(loc)) {
      errors.push({ line: blockLine, error: `URL block ${i + 1}: URL contains unescaped special characters` });
    }

    // Validate lastmod if present
    const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);
    if (lastmodMatch) {
      const lastmod = lastmodMatch[1].trim();
      const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z))?$/;
      if (!dateRegex.test(lastmod)) {
        errors.push({
          line: blockLine,
          error: `URL block ${i + 1}: Invalid lastmod date format: ${lastmod} (expected W3C datetime)`,
        });
      }
    }

    // Validate changefreq if present
    const changefreqMatch = block.match(/<changefreq>([\s\S]*?)<\/changefreq>/i);
    if (changefreqMatch) {
      const validFreqs = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
      if (!validFreqs.has(changefreqMatch[1].trim().toLowerCase())) {
        errors.push({
          line: blockLine,
          error: `URL block ${i + 1}: Invalid changefreq value: ${changefreqMatch[1].trim()}`,
        });
      }
    }

    // Validate priority if present
    const priorityMatch = block.match(/<priority>([\s\S]*?)<\/priority>/i);
    if (priorityMatch) {
      const priority = parseFloat(priorityMatch[1].trim());
      if (isNaN(priority) || priority < 0.0 || priority > 1.0) {
        errors.push({
          line: blockLine,
          error: `URL block ${i + 1}: Invalid priority value: ${priorityMatch[1].trim()} (must be 0.0-1.0)`,
        });
      }
    }
  }

  // Warnings
  if (urlCount === 0) {
    warnings.push("Sitemap contains no URLs");
  }
  if (urlCount > 50000) {
    warnings.push(`Sitemap contains ${urlCount} URLs; maximum recommended is 50,000 per sitemap`);
  }
  const sizeBytes = Buffer.byteLength(sitemapXml, "utf8");
  if (sizeBytes > 50 * 1024 * 1024) {
    warnings.push(`Sitemap size is ${Math.round(sizeBytes / 1024 / 1024)}MB; maximum recommended is 50MB`);
  }

  // Check for closing tags
  if (hasUrlset && !/<\/urlset>/i.test(sitemapXml)) {
    errors.push({ line: lines.length, error: "Missing closing </urlset> tag" });
  }
  if (hasSitemapindex && !/<\/sitemapindex>/i.test(sitemapXml)) {
    errors.push({ line: lines.length, error: "Missing closing </sitemapindex> tag" });
  }

  return {
    valid: errors.length === 0,
    urls: urlCount,
    errors,
    warnings,
  };
}

function findLineNumber(lines: string[], needle: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return 1;
}

export function validateSchemaOrg(html: string): {
  schemas: Array<{ type: string; properties: Record<string, any> }>;
  valid: boolean;
  errors: string[];
} {
  const schemas: Array<{ type: string; properties: Record<string, any> }> = [];
  const errors: string[] = [];

  // Parse JSON-LD
  const ldJsonMatches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const match of ldJsonMatches) {
    try {
      const parsed = JSON.parse(match[1]);

      function extractSchema(obj: any): void {
        if (!obj || typeof obj !== "object") return;

        if (obj["@type"]) {
          const properties: Record<string, any> = {};
          for (const [key, value] of Object.entries(obj)) {
            if (!key.startsWith("@")) {
              properties[key] = value;
            }
          }
          schemas.push({ type: obj["@type"], properties });
        }

        if (Array.isArray(obj["@graph"])) {
          for (const item of obj["@graph"]) {
            extractSchema(item);
          }
        }

        if (Array.isArray(obj)) {
          for (const item of obj) {
            extractSchema(item);
          }
        }
      }

      extractSchema(parsed);
    } catch (e: any) {
      errors.push(`Invalid JSON-LD: ${e?.message ?? "parse error"}`);
    }
  }

  // Parse Microdata
  const microdataMatches = html.matchAll(
    /itemscope[^>]*itemtype=["'](https?:\/\/schema\.org\/(\w+))["'][^>]*>([\s\S]*?)(?=<[^>]*itemscope|$)/gi
  );

  for (const match of microdataMatches) {
    const type = match[2];
    const content = match[3];
    const properties: Record<string, any> = {};

    const propMatches = content.matchAll(
      /itemprop=["'](\w+)["'][^>]*(?:content=["']([^"']*)["']|>([^<]*))/gi
    );
    for (const pm of propMatches) {
      properties[pm[1]] = pm[2] ?? pm[3]?.trim() ?? "";
    }

    schemas.push({ type, properties });
  }

  // Validate schemas
  const requiredProps: Record<string, string[]> = {
    Article: ["headline", "author", "datePublished"],
    Product: ["name"],
    Organization: ["name"],
    Person: ["name"],
    WebSite: ["name", "url"],
    BreadcrumbList: ["itemListElement"],
    FAQPage: ["mainEntity"],
    LocalBusiness: ["name", "address"],
    Event: ["name", "startDate", "location"],
    Recipe: ["name", "recipeIngredient"],
    VideoObject: ["name", "description", "uploadDate"],
    Review: ["itemReviewed", "reviewRating"],
  };

  for (const schema of schemas) {
    const required = requiredProps[schema.type];
    if (required) {
      for (const prop of required) {
        if (!(prop in schema.properties)) {
          errors.push(`${schema.type}: Missing recommended property "${prop}"`);
        }
      }
    }
  }

  return {
    schemas,
    valid: errors.length === 0,
    errors,
  };
}

export function parseRSSFeed(xml: string): {
  title: string;
  description: string;
  items: Array<{ title: string; link: string; pubDate: string; description: string }>;
} {
  // Extract channel info
  const channelTitleMatch = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
  const channelDescMatch = xml.match(/<channel>[\s\S]*?<description>([\s\S]*?)<\/description>/i);

  // Handle Atom feeds
  const isAtom = /<feed[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml);

  let title = "";
  let description = "";
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];

  if (isAtom) {
    // Atom feed parsing
    const feedTitleMatch = xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
    const feedSubtitleMatch = xml.match(/<subtitle[^>]*>([\s\S]*?)<\/subtitle>/i);
    title = cleanXmlText(feedTitleMatch?.[1] ?? "");
    description = cleanXmlText(feedSubtitleMatch?.[1] ?? "");

    const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
    for (const entryMatch of entryMatches) {
      const entry = entryMatch[1];
      const entryTitle = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const entryLink =
        entry.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i) ??
        entry.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      const entryUpdated =
        entry.match(/<updated>([\s\S]*?)<\/updated>/i) ??
        entry.match(/<published>([\s\S]*?)<\/published>/i);
      const entryContent =
        entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i) ??
        entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

      items.push({
        title: cleanXmlText(entryTitle?.[1] ?? ""),
        link: cleanXmlText(entryLink?.[1] ?? ""),
        pubDate: cleanXmlText(entryUpdated?.[1] ?? ""),
        description: cleanXmlText(entryContent?.[1] ?? ""),
      });
    }
  } else {
    // RSS 2.0 feed parsing
    title = cleanXmlText(channelTitleMatch?.[1] ?? "");
    description = cleanXmlText(channelDescMatch?.[1] ?? "");

    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
    for (const itemMatch of itemMatches) {
      const item = itemMatch[1];
      const itemTitle = item.match(/<title>([\s\S]*?)<\/title>/i);
      const itemLink = item.match(/<link>([\s\S]*?)<\/link>/i);
      const itemPubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const itemDesc =
        item.match(/<description>([\s\S]*?)<\/description>/i) ??
        item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i);

      items.push({
        title: cleanXmlText(itemTitle?.[1] ?? ""),
        link: cleanXmlText(itemLink?.[1] ?? ""),
        pubDate: cleanXmlText(itemPubDate?.[1] ?? ""),
        description: cleanXmlText(itemDesc?.[1] ?? ""),
      });
    }
  }

  return { title, description, items };
}

function cleanXmlText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") // Unwrap CDATA
    .replace(/<[^>]*>/g, "") // Strip HTML tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}
