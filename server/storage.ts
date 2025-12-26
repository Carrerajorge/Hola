import { 
  type User, type InsertUser, 
  type File, type InsertFile, 
  type FileChunk, type InsertFileChunk,
  type FileJob, type InsertFileJob,
  type AgentRun, type InsertAgentRun,
  type AgentStep, type InsertAgentStep,
  type AgentAsset, type InsertAgentAsset,
  type DomainPolicy, type InsertDomainPolicy,
  type Chat, type InsertChat,
  type ChatMessage, type InsertChatMessage,
  type ChatShare, type InsertChatShare,
  type ChatRun, type InsertChatRun,
  type ToolInvocation, type InsertToolInvocation,
  type Gpt, type InsertGpt,
  type GptCategory, type InsertGptCategory,
  type GptVersion, type InsertGptVersion,
  type AiModel, type InsertAiModel,
  type Payment, type InsertPayment,
  type Invoice, type InsertInvoice,
  type PlatformSetting, type InsertPlatformSetting,
  type AuditLog, type InsertAuditLog,
  type AnalyticsSnapshot, type InsertAnalyticsSnapshot,
  type Report, type InsertReport,
  type LibraryItem, type InsertLibraryItem,
  type NotificationEventType, type NotificationPreference, type InsertNotificationPreference,
  type UserSettings, type InsertUserSettings,
  type IntegrationProvider, type InsertIntegrationProvider,
  type IntegrationAccount, type InsertIntegrationAccount,
  type IntegrationTool, type InsertIntegrationTool,
  type IntegrationPolicy, type InsertIntegrationPolicy,
  type ToolCallLog, type InsertToolCallLog,
  type ConsentLog, type SharedLink, type InsertSharedLink,
  type CompanyKnowledge, type InsertCompanyKnowledge,
  type GmailOAuthToken, type InsertGmailOAuthToken,
  type ResponseQualityMetric, type InsertResponseQualityMetric,
  type ConnectorUsageHourly, type InsertConnectorUsageHourly,
  type OfflineMessageQueue, type InsertOfflineMessageQueue,
  files, fileChunks, fileJobs, agentRuns, agentSteps, agentAssets, domainPolicies, chats, chatMessages, chatShares,
  chatRuns, toolInvocations,
  gpts, gptCategories, gptVersions, users,
  aiModels, payments, invoices, platformSettings, auditLogs, analyticsSnapshots, reports, libraryItems,
  notificationEventTypes, notificationPreferences, userSettings,
  integrationProviders, integrationAccounts, integrationTools, integrationPolicies, toolCallLogs,
  consentLogs, sharedLinks, companyKnowledge, gmailOAuthTokens,
  responseQualityMetrics, connectorUsageHourly, offlineMessageQueue
} from "@shared/schema";
import crypto, { randomUUID } from "crypto";
import { db } from "./db";
import { eq, sql, desc, and, isNull } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createFile(file: InsertFile): Promise<File>;
  getFile(id: string): Promise<File | undefined>;
  getFiles(userId?: string): Promise<File[]>;
  updateFileStatus(id: string, status: string): Promise<File | undefined>;
  deleteFile(id: string): Promise<void>;
  updateFileProgress(id: string, progress: number): Promise<File | undefined>;
  updateFileError(id: string, error: string): Promise<File | undefined>;
  updateFileCompleted(id: string): Promise<File | undefined>;
  updateFileUploadChunks(id: string, uploadedChunks: number, totalChunks: number): Promise<File | undefined>;
  createFileJob(job: InsertFileJob): Promise<FileJob>;
  getFileJob(fileId: string): Promise<FileJob | undefined>;
  updateFileJobStatus(fileId: string, status: string, error?: string): Promise<FileJob | undefined>;
  createFileChunks(chunks: InsertFileChunk[]): Promise<FileChunk[]>;
  getFileChunks(fileId: string): Promise<FileChunk[]>;
  searchSimilarChunks(embedding: number[], limit?: number): Promise<FileChunk[]>;
  updateFileChunkEmbedding(fileId: string, chunkIndex: number, embedding: number[]): Promise<void>;
  // Agent CRUD operations
  createAgentRun(run: InsertAgentRun): Promise<AgentRun>;
  getAgentRun(id: string): Promise<AgentRun | undefined>;
  updateAgentRunStatus(id: string, status: string, error?: string): Promise<AgentRun | undefined>;
  createAgentStep(step: InsertAgentStep): Promise<AgentStep>;
  getAgentSteps(runId: string): Promise<AgentStep[]>;
  updateAgentStepStatus(id: string, success: string, error?: string): Promise<AgentStep | undefined>;
  createAgentAsset(asset: InsertAgentAsset): Promise<AgentAsset>;
  getAgentAssets(runId: string): Promise<AgentAsset[]>;
  getDomainPolicy(domain: string): Promise<DomainPolicy | undefined>;
  createDomainPolicy(policy: InsertDomainPolicy): Promise<DomainPolicy>;
  // Chat CRUD operations
  createChat(chat: InsertChat): Promise<Chat>;
  getChat(id: string): Promise<Chat | undefined>;
  getChats(userId?: string): Promise<Chat[]>;
  updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined>;
  deleteChat(id: string): Promise<void>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessages(chatId: string): Promise<ChatMessage[]>;
  updateChatMessageContent(id: string, content: string, status: string): Promise<ChatMessage | undefined>;
  // Chat Run operations (for idempotent message processing)
  createChatRun(run: InsertChatRun): Promise<ChatRun>;
  getChatRun(id: string): Promise<ChatRun | undefined>;
  getChatRunByClientRequestId(chatId: string, clientRequestId: string): Promise<ChatRun | undefined>;
  claimPendingRun(chatId: string, clientRequestId?: string): Promise<ChatRun | undefined>;
  updateChatRunStatus(id: string, status: string, error?: string): Promise<ChatRun | undefined>;
  updateChatRunAssistantMessage(id: string, assistantMessageId: string): Promise<ChatRun | undefined>;
  updateChatRunLastSeq(id: string, lastSeq: number): Promise<ChatRun | undefined>;
  createUserMessageAndRun(chatId: string, message: InsertChatMessage, clientRequestId: string): Promise<{ message: ChatMessage; run: ChatRun }>;
  // Tool Invocation operations (for idempotent tool calls)
  createToolInvocation(invocation: InsertToolInvocation): Promise<ToolInvocation>;
  getToolInvocation(runId: string, toolCallId: string): Promise<ToolInvocation | undefined>;
  updateToolInvocationResult(id: string, output: any, status: string, error?: string): Promise<ToolInvocation | undefined>;
  // Chat Share operations
  createChatShare(share: InsertChatShare): Promise<ChatShare>;
  getChatShares(chatId: string): Promise<ChatShare[]>;
  getChatSharesByEmail(email: string): Promise<ChatShare[]>;
  getChatSharesByUserId(userId: string): Promise<ChatShare[]>;
  getSharedChatsWithDetails(userId: string): Promise<(Chat & { shareRole: string; shareId: string })[]>;
  getChatShareByEmailAndChat(email: string, chatId: string): Promise<ChatShare | undefined>;
  getChatShareByUserAndChat(userId: string, chatId: string): Promise<ChatShare | undefined>;
  updateChatShare(id: string, updates: Partial<InsertChatShare>): Promise<ChatShare | undefined>;
  deleteChatShare(id: string): Promise<void>;
  getUserByEmail(email: string): Promise<User | undefined>;
  // GPT CRUD operations
  createGpt(gpt: InsertGpt): Promise<Gpt>;
  getGpt(id: string): Promise<Gpt | undefined>;
  getGptBySlug(slug: string): Promise<Gpt | undefined>;
  getGpts(filters?: { visibility?: string; categoryId?: string; creatorId?: string }): Promise<Gpt[]>;
  getPopularGpts(limit?: number): Promise<Gpt[]>;
  updateGpt(id: string, updates: Partial<InsertGpt>): Promise<Gpt | undefined>;
  deleteGpt(id: string): Promise<void>;
  incrementGptUsage(id: string): Promise<void>;
  // GPT Category operations
  createGptCategory(category: InsertGptCategory): Promise<GptCategory>;
  getGptCategories(): Promise<GptCategory[]>;
  // GPT Version operations
  createGptVersion(version: InsertGptVersion): Promise<GptVersion>;
  getGptVersions(gptId: string): Promise<GptVersion[]>;
  getLatestGptVersion(gptId: string): Promise<GptVersion | undefined>;
  // Admin: User management
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  getUserStats(): Promise<{ total: number; active: number; newThisMonth: number }>;
  // Admin: AI Models
  createAiModel(model: InsertAiModel): Promise<AiModel>;
  getAiModels(): Promise<AiModel[]>;
  updateAiModel(id: string, updates: Partial<InsertAiModel>): Promise<AiModel | undefined>;
  deleteAiModel(id: string): Promise<void>;
  // Admin: Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPayments(): Promise<Payment[]>;
  updatePayment(id: string, updates: Partial<InsertPayment>): Promise<Payment | undefined>;
  getPaymentStats(): Promise<{ total: string; thisMonth: string; count: number }>;
  // Admin: Invoices
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoices(): Promise<Invoice[]>;
  updateInvoice(id: string, updates: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  // Admin: Settings
  getSetting(key: string): Promise<PlatformSetting | undefined>;
  getSettings(): Promise<PlatformSetting[]>;
  upsertSetting(key: string, value: string, description?: string, category?: string): Promise<PlatformSetting>;
  // Admin: Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  // Admin: Analytics
  createAnalyticsSnapshot(snapshot: InsertAnalyticsSnapshot): Promise<AnalyticsSnapshot>;
  getAnalyticsSnapshots(days?: number): Promise<AnalyticsSnapshot[]>;
  getDashboardMetrics(): Promise<{ users: number; queries: number; revenue: string; uptime: number }>;
  // Admin: Reports
  createReport(report: InsertReport): Promise<Report>;
  getReports(): Promise<Report[]>;
  updateReport(id: string, updates: Partial<InsertReport>): Promise<Report | undefined>;
  // Admin: Domain Policies
  getDomainPolicies(): Promise<DomainPolicy[]>;
  updateDomainPolicy(id: string, updates: Partial<InsertDomainPolicy>): Promise<DomainPolicy | undefined>;
  deleteDomainPolicy(id: string): Promise<void>;
  // Library Items CRUD
  createLibraryItem(item: InsertLibraryItem): Promise<LibraryItem>;
  getLibraryItems(userId: string, mediaType?: string): Promise<LibraryItem[]>;
  getLibraryItem(id: string, userId: string): Promise<LibraryItem | null>;
  deleteLibraryItem(id: string, userId: string): Promise<boolean>;
  // Notification Preferences
  getNotificationEventTypes(): Promise<NotificationEventType[]>;
  getNotificationPreferences(userId: string): Promise<NotificationPreference[]>;
  upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference>;
  // User Settings
  getUserSettings(userId: string): Promise<UserSettings | null>;
  upsertUserSettings(userId: string, settings: Partial<InsertUserSettings>): Promise<UserSettings>;
  // Integration Management
  getIntegrationProviders(): Promise<IntegrationProvider[]>;
  getIntegrationProvider(id: string): Promise<IntegrationProvider | null>;
  createIntegrationProvider(provider: InsertIntegrationProvider): Promise<IntegrationProvider>;
  getIntegrationAccounts(userId: string): Promise<IntegrationAccount[]>;
  getIntegrationAccount(id: string): Promise<IntegrationAccount | null>;
  getIntegrationAccountByProvider(userId: string, providerId: string): Promise<IntegrationAccount | null>;
  createIntegrationAccount(account: InsertIntegrationAccount): Promise<IntegrationAccount>;
  updateIntegrationAccount(id: string, updates: Partial<InsertIntegrationAccount>): Promise<IntegrationAccount | null>;
  deleteIntegrationAccount(id: string): Promise<void>;
  getIntegrationTools(providerId?: string): Promise<IntegrationTool[]>;
  getIntegrationPolicy(userId: string): Promise<IntegrationPolicy | null>;
  upsertIntegrationPolicy(userId: string, policy: Partial<InsertIntegrationPolicy>): Promise<IntegrationPolicy>;
  createToolCallLog(log: InsertToolCallLog): Promise<ToolCallLog>;
  getToolCallLogs(userId: string, limit?: number): Promise<ToolCallLog[]>;
  // Consent Logs
  logConsent(userId: string, consentType: string, value: string, ipAddress?: string, userAgent?: string): Promise<void>;
  getConsentLogs(userId: string, limit?: number): Promise<ConsentLog[]>;
  // Shared Links CRUD
  createSharedLink(data: InsertSharedLink): Promise<SharedLink>;
  getSharedLinks(userId: string): Promise<SharedLink[]>;
  getSharedLinkByToken(token: string): Promise<SharedLink | undefined>;
  updateSharedLink(id: string, data: Partial<InsertSharedLink>): Promise<SharedLink>;
  revokeSharedLink(id: string): Promise<void>;
  rotateSharedLinkToken(id: string): Promise<SharedLink>;
  incrementSharedLinkAccess(id: string): Promise<void>;
  // Archived/Deleted Chats
  getArchivedChats(userId: string): Promise<Chat[]>;
  unarchiveChat(chatId: string): Promise<void>;
  archiveAllChats(userId: string): Promise<number>;
  softDeleteChat(chatId: string): Promise<void>;
  softDeleteAllChats(userId: string): Promise<number>;
  getDeletedChats(userId: string): Promise<Chat[]>;
  restoreDeletedChat(chatId: string): Promise<void>;
  permanentlyDeleteChat(chatId: string): Promise<void>;
  // Company Knowledge
  getCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]>;
  getActiveCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]>;
  createCompanyKnowledge(knowledge: InsertCompanyKnowledge): Promise<CompanyKnowledge>;
  updateCompanyKnowledge(id: string, updates: Partial<InsertCompanyKnowledge>): Promise<CompanyKnowledge | null>;
  deleteCompanyKnowledge(id: string): Promise<void>;
  // Gmail OAuth Token operations (Custom MCP)
  getGmailOAuthToken(userId: string): Promise<GmailOAuthToken | null>;
  saveGmailOAuthToken(token: InsertGmailOAuthToken): Promise<GmailOAuthToken>;
  updateGmailOAuthToken(userId: string, updates: Partial<InsertGmailOAuthToken>): Promise<GmailOAuthToken | null>;
  deleteGmailOAuthToken(userId: string): Promise<void>;
  // Message Idempotency operations
  findMessageByRequestId(requestId: string): Promise<ChatMessage | null>;
  claimPendingMessage(messageId: string): Promise<ChatMessage | null>;
  updateMessageStatus(messageId: string, status: 'pending' | 'processing' | 'done' | 'failed'): Promise<ChatMessage | null>;
  updateMessageContent(messageId: string, content: string, additionalData?: Partial<InsertChatMessage>): Promise<ChatMessage | null>;
  findAssistantResponseForUserMessage(userMessageId: string): Promise<ChatMessage | null>;
  // Response Quality Metrics
  recordQualityMetric(metric: InsertResponseQualityMetric): Promise<ResponseQualityMetric>;
  getQualityMetrics(since: Date, limit?: number): Promise<ResponseQualityMetric[]>;
  // Connector Usage Hourly
  upsertConnectorUsage(connector: string, hourBucket: Date, success: boolean, latencyMs: number): Promise<ConnectorUsageHourly>;
  getConnectorUsageStats(connector: string, since: Date): Promise<ConnectorUsageHourly[]>;
  // Offline Message Queue
  createOfflineMessage(message: InsertOfflineMessageQueue): Promise<OfflineMessageQueue>;
  getOfflineMessages(userId: string, status?: string): Promise<OfflineMessageQueue[]>;
  updateOfflineMessageStatus(id: string, status: string, error?: string): Promise<OfflineMessageQueue | null>;
  syncOfflineMessage(id: string): Promise<OfflineMessageQueue | null>;
  // Chat Stats
  updateChatMessageStats(chatId: string): Promise<Chat | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createFile(insertFile: InsertFile): Promise<File> {
    const [file] = await db.insert(files).values(insertFile).returning();
    return file;
  }

  async getFile(id: string): Promise<File | undefined> {
    const [file] = await db.select().from(files).where(eq(files.id, id));
    return file;
  }

  async getFiles(userId?: string): Promise<File[]> {
    if (userId) {
      return db.select().from(files).where(eq(files.userId, userId)).orderBy(desc(files.createdAt));
    }
    return db.select().from(files).orderBy(desc(files.createdAt));
  }

  async updateFileStatus(id: string, status: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({ status }).where(eq(files.id, id)).returning();
    return file;
  }

  async deleteFile(id: string): Promise<void> {
    await db.delete(files).where(eq(files.id, id));
  }

  async updateFileProgress(id: string, progress: number): Promise<File | undefined> {
    const [file] = await db.update(files).set({ processingProgress: progress }).where(eq(files.id, id)).returning();
    return file;
  }

  async updateFileError(id: string, error: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({ processingError: error, status: "failed" }).where(eq(files.id, id)).returning();
    return file;
  }

  async updateFileCompleted(id: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({ 
      status: "completed", 
      processingProgress: 100, 
      completedAt: new Date() 
    }).where(eq(files.id, id)).returning();
    return file;
  }

  async updateFileUploadChunks(id: string, uploadedChunks: number, totalChunks: number): Promise<File | undefined> {
    const [file] = await db.update(files).set({ 
      uploadedChunks, 
      totalChunks 
    }).where(eq(files.id, id)).returning();
    return file;
  }

  async createFileJob(job: InsertFileJob): Promise<FileJob> {
    const [result] = await db.insert(fileJobs).values(job).returning();
    return result;
  }

  async getFileJob(fileId: string): Promise<FileJob | undefined> {
    const [result] = await db.select().from(fileJobs).where(eq(fileJobs.fileId, fileId));
    return result;
  }

  async updateFileJobStatus(fileId: string, status: string, error?: string): Promise<FileJob | undefined> {
    const updates: Partial<FileJob> = { status };
    if (status === "processing") {
      updates.startedAt = new Date();
    }
    if (status === "completed" || status === "failed") {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.lastError = error;
      updates.retries = sql`${fileJobs.retries} + 1` as any;
    }
    const [result] = await db.update(fileJobs).set(updates).where(eq(fileJobs.fileId, fileId)).returning();
    return result;
  }

  async createFileChunks(chunks: InsertFileChunk[]): Promise<FileChunk[]> {
    if (chunks.length === 0) return [];
    const result = await db.insert(fileChunks).values(chunks).returning();
    return result;
  }

  async getFileChunks(fileId: string): Promise<FileChunk[]> {
    return db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
  }

  async searchSimilarChunks(embedding: number[], limit: number = 5): Promise<FileChunk[]> {
    const embeddingStr = `[${embedding.join(",")}]`;
    const result = await db.execute(sql`
      SELECT fc.*, f.name as file_name,
        fc.embedding <=> ${embeddingStr}::vector AS distance
      FROM file_chunks fc
      JOIN files f ON fc.file_id = f.id
      WHERE fc.embedding IS NOT NULL
      ORDER BY fc.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);
    return result.rows as FileChunk[];
  }

  async updateFileChunkEmbedding(fileId: string, chunkIndex: number, embedding: number[]): Promise<void> {
    await db.update(fileChunks)
      .set({ embedding })
      .where(and(eq(fileChunks.fileId, fileId), eq(fileChunks.chunkIndex, chunkIndex)));
  }

  async createAgentRun(run: InsertAgentRun): Promise<AgentRun> {
    const [result] = await db.insert(agentRuns).values(run).returning();
    return result;
  }

  async getAgentRun(id: string): Promise<AgentRun | undefined> {
    const [result] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
    return result;
  }

  async updateAgentRunStatus(id: string, status: string, error?: string): Promise<AgentRun | undefined> {
    const updates: Partial<AgentRun> = { status };
    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(agentRuns).set(updates).where(eq(agentRuns.id, id)).returning();
    return result;
  }

  async createAgentStep(step: InsertAgentStep): Promise<AgentStep> {
    const [result] = await db.insert(agentSteps).values(step).returning();
    return result;
  }

  async getAgentSteps(runId: string): Promise<AgentStep[]> {
    return db.select().from(agentSteps).where(eq(agentSteps.runId, runId)).orderBy(agentSteps.stepIndex);
  }

  async updateAgentStepStatus(id: string, success: string, error?: string): Promise<AgentStep | undefined> {
    const updates: Partial<AgentStep> = { success, completedAt: new Date() };
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(agentSteps).set(updates).where(eq(agentSteps.id, id)).returning();
    return result;
  }

  async createAgentAsset(asset: InsertAgentAsset): Promise<AgentAsset> {
    const [result] = await db.insert(agentAssets).values(asset).returning();
    return result;
  }

  async getAgentAssets(runId: string): Promise<AgentAsset[]> {
    return db.select().from(agentAssets).where(eq(agentAssets.runId, runId));
  }

  async getDomainPolicy(domain: string): Promise<DomainPolicy | undefined> {
    const [result] = await db.select().from(domainPolicies).where(eq(domainPolicies.domain, domain));
    return result;
  }

  async createDomainPolicy(policy: InsertDomainPolicy): Promise<DomainPolicy> {
    const [result] = await db.insert(domainPolicies).values(policy).returning();
    return result;
  }

  async createChat(chat: InsertChat): Promise<Chat> {
    const [result] = await db.insert(chats).values(chat).returning();
    return result;
  }

  async getChat(id: string): Promise<Chat | undefined> {
    const [result] = await db.select().from(chats).where(eq(chats.id, id));
    return result;
  }

  async getChats(userId?: string): Promise<Chat[]> {
    if (userId) {
      return db.select().from(chats).where(eq(chats.userId, userId)).orderBy(desc(chats.updatedAt));
    }
    return db.select().from(chats).orderBy(desc(chats.updatedAt));
  }

  async updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined> {
    const [result] = await db.update(chats).set({ ...updates, updatedAt: new Date() }).where(eq(chats.id, id)).returning();
    return result;
  }

  async deleteChat(id: string): Promise<void> {
    await db.delete(chats).where(eq(chats.id, id));
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [result] = await db.insert(chatMessages).values(message).returning();
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, message.chatId));
    return result;
  }

  async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.chatId, chatId)).orderBy(chatMessages.createdAt);
  }

  async updateChatMessageContent(id: string, content: string, status: string): Promise<ChatMessage | undefined> {
    const [result] = await db.update(chatMessages)
      .set({ content, status })
      .where(eq(chatMessages.id, id))
      .returning();
    return result;
  }

  async saveDocumentToChat(chatId: string, document: { type: string; title: string; content: string }): Promise<ChatMessage> {
    // Find the last "Documento generado correctamente" message to attach the document to
    const messages = await db.select().from(chatMessages)
      .where(and(
        eq(chatMessages.chatId, chatId),
        eq(chatMessages.role, "assistant")
      ))
      .orderBy(desc(chatMessages.createdAt));
    
    const docGenMessage = messages.find(m => 
      m.content?.includes("Documento generado correctamente") || 
      m.content?.includes("Presentación generada correctamente")
    );
    
    const attachment = {
      type: "document",
      name: document.title,
      documentType: document.type,
      title: document.title,
      content: document.content,
      savedAt: new Date().toISOString()
    };
    
    if (docGenMessage) {
      // Update existing message with the document attachment
      const existingAttachments = Array.isArray(docGenMessage.attachments) ? docGenMessage.attachments : [];
      const [result] = await db.update(chatMessages)
        .set({ attachments: [...existingAttachments, attachment] })
        .where(eq(chatMessages.id, docGenMessage.id))
        .returning();
      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      return result;
    } else {
      // Fallback: create new system message if no "Documento generado" message found
      const [result] = await db.insert(chatMessages).values({
        chatId,
        role: "system",
        content: `Documento guardado: ${document.title}`,
        attachments: [attachment],
        status: "done"
      }).returning();
      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      return result;
    }
  }

  // Chat Run operations (for idempotent message processing)
  async createChatRun(run: InsertChatRun): Promise<ChatRun> {
    const [result] = await db.insert(chatRuns).values(run).returning();
    return result;
  }

  async getChatRun(id: string): Promise<ChatRun | undefined> {
    const [result] = await db.select().from(chatRuns).where(eq(chatRuns.id, id));
    return result;
  }

  async getChatRunByClientRequestId(chatId: string, clientRequestId: string): Promise<ChatRun | undefined> {
    const [result] = await db.select().from(chatRuns).where(
      and(eq(chatRuns.chatId, chatId), eq(chatRuns.clientRequestId, clientRequestId))
    );
    return result;
  }

  async claimPendingRun(chatId: string, clientRequestId?: string): Promise<ChatRun | undefined> {
    // If clientRequestId is provided, claim that specific run
    if (clientRequestId) {
      const [result] = await db.update(chatRuns)
        .set({ status: 'processing', startedAt: new Date() })
        .where(and(
          eq(chatRuns.chatId, chatId),
          eq(chatRuns.clientRequestId, clientRequestId),
          eq(chatRuns.status, 'pending')
        ))
        .returning();
      return result;
    }
    // Otherwise claim any pending run for the chat
    const [result] = await db.update(chatRuns)
      .set({ status: 'processing', startedAt: new Date() })
      .where(and(eq(chatRuns.chatId, chatId), eq(chatRuns.status, 'pending')))
      .returning();
    return result;
  }

  async updateChatRunStatus(id: string, status: string, error?: string): Promise<ChatRun | undefined> {
    const updates: any = { status };
    if (status === 'done' || status === 'failed') {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(chatRuns).set(updates).where(eq(chatRuns.id, id)).returning();
    return result;
  }

  async updateChatRunAssistantMessage(id: string, assistantMessageId: string): Promise<ChatRun | undefined> {
    const [result] = await db.update(chatRuns)
      .set({ assistantMessageId })
      .where(eq(chatRuns.id, id))
      .returning();
    return result;
  }

  async updateChatRunLastSeq(id: string, lastSeq: number): Promise<ChatRun | undefined> {
    const [result] = await db.update(chatRuns)
      .set({ lastSeq })
      .where(eq(chatRuns.id, id))
      .returning();
    return result;
  }

  async createUserMessageAndRun(chatId: string, message: InsertChatMessage, clientRequestId: string): Promise<{ message: ChatMessage; run: ChatRun }> {
    return await db.transaction(async (tx) => {
      const [savedMessage] = await tx.insert(chatMessages).values(message).returning();
      const [run] = await tx.insert(chatRuns).values({
        chatId,
        clientRequestId,
        userMessageId: savedMessage.id,
        status: 'pending',
      }).returning();
      await tx.update(chatMessages).set({ runId: run.id }).where(eq(chatMessages.id, savedMessage.id));
      await tx.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      return { message: { ...savedMessage, runId: run.id }, run };
    });
  }

  // Tool Invocation operations
  async createToolInvocation(invocation: InsertToolInvocation): Promise<ToolInvocation> {
    const [result] = await db.insert(toolInvocations).values(invocation).returning();
    return result;
  }

  async getToolInvocation(runId: string, toolCallId: string): Promise<ToolInvocation | undefined> {
    const [result] = await db.select().from(toolInvocations).where(
      and(eq(toolInvocations.runId, runId), eq(toolInvocations.toolCallId, toolCallId))
    );
    return result;
  }

  async updateToolInvocationResult(id: string, output: any, status: string, error?: string): Promise<ToolInvocation | undefined> {
    const updates: any = { output, status };
    if (status === 'done' || status === 'failed') {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(toolInvocations).set(updates).where(eq(toolInvocations.id, id)).returning();
    return result;
  }

  // Chat Share operations
  async createChatShare(share: InsertChatShare): Promise<ChatShare> {
    const [result] = await db.insert(chatShares).values(share).returning();
    return result;
  }

  async getChatShares(chatId: string): Promise<ChatShare[]> {
    return db.select().from(chatShares).where(eq(chatShares.chatId, chatId)).orderBy(desc(chatShares.createdAt));
  }

  async getChatSharesByEmail(email: string): Promise<ChatShare[]> {
    const normalizedEmail = email.toLowerCase().trim();
    return db.select().from(chatShares).where(sql`LOWER(${chatShares.email}) = ${normalizedEmail}`).orderBy(desc(chatShares.createdAt));
  }

  async getChatSharesByUserId(userId: string): Promise<ChatShare[]> {
    return db.select().from(chatShares).where(eq(chatShares.recipientUserId, userId)).orderBy(desc(chatShares.createdAt));
  }

  async getSharedChatsWithDetails(userId: string): Promise<(Chat & { shareRole: string; shareId: string })[]> {
    const results = await db
      .select({
        id: chats.id,
        title: chats.title,
        userId: chats.userId,
        gptId: chats.gptId,
        archived: chats.archived,
        hidden: chats.hidden,
        deletedAt: chats.deletedAt,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
        shareRole: chatShares.role,
        shareId: chatShares.id,
      })
      .from(chatShares)
      .innerJoin(chats, eq(chatShares.chatId, chats.id))
      .where(eq(chatShares.recipientUserId, userId))
      .orderBy(desc(chatShares.createdAt));
    
    return results as (Chat & { shareRole: string; shareId: string })[];
  }

  async getChatShareByEmailAndChat(email: string, chatId: string): Promise<ChatShare | undefined> {
    const normalizedEmail = email.toLowerCase().trim();
    const [result] = await db.select().from(chatShares)
      .where(sql`LOWER(${chatShares.email}) = ${normalizedEmail} AND ${chatShares.chatId} = ${chatId}`);
    return result;
  }

  async getChatShareByUserAndChat(userId: string, chatId: string): Promise<ChatShare | undefined> {
    const [result] = await db.select().from(chatShares)
      .where(sql`${chatShares.recipientUserId} = ${userId} AND ${chatShares.chatId} = ${chatId}`);
    return result;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalizedEmail = email.toLowerCase().trim();
    const [result] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${normalizedEmail}`);
    return result;
  }

  async updateChatShare(id: string, updates: Partial<InsertChatShare>): Promise<ChatShare | undefined> {
    const [result] = await db.update(chatShares).set(updates).where(eq(chatShares.id, id)).returning();
    return result;
  }

  async deleteChatShare(id: string): Promise<void> {
    await db.delete(chatShares).where(eq(chatShares.id, id));
  }

  // GPT operations
  async createGpt(gpt: InsertGpt): Promise<Gpt> {
    const [result] = await db.insert(gpts).values(gpt).returning();
    return result;
  }

  async getGpt(id: string): Promise<Gpt | undefined> {
    const [result] = await db.select().from(gpts).where(eq(gpts.id, id));
    return result;
  }

  async getGptBySlug(slug: string): Promise<Gpt | undefined> {
    const [result] = await db.select().from(gpts).where(eq(gpts.slug, slug));
    return result;
  }

  async getGpts(filters?: { visibility?: string; categoryId?: string; creatorId?: string }): Promise<Gpt[]> {
    let query = db.select().from(gpts);
    if (filters?.visibility) {
      query = query.where(eq(gpts.visibility, filters.visibility)) as typeof query;
    }
    if (filters?.categoryId) {
      query = query.where(eq(gpts.categoryId, filters.categoryId)) as typeof query;
    }
    if (filters?.creatorId) {
      query = query.where(eq(gpts.creatorId, filters.creatorId)) as typeof query;
    }
    return query.orderBy(desc(gpts.createdAt));
  }

  async getPopularGpts(limit: number = 10): Promise<Gpt[]> {
    return db.select().from(gpts)
      .where(eq(gpts.visibility, "public"))
      .orderBy(desc(gpts.usageCount))
      .limit(limit);
  }

  async updateGpt(id: string, updates: Partial<InsertGpt>): Promise<Gpt | undefined> {
    const [result] = await db.update(gpts).set({ ...updates, updatedAt: new Date() }).where(eq(gpts.id, id)).returning();
    return result;
  }

  async deleteGpt(id: string): Promise<void> {
    await db.delete(gpts).where(eq(gpts.id, id));
  }

  async incrementGptUsage(id: string): Promise<void> {
    await db.update(gpts).set({ usageCount: sql`${gpts.usageCount} + 1` }).where(eq(gpts.id, id));
  }

  // GPT Category operations
  async createGptCategory(category: InsertGptCategory): Promise<GptCategory> {
    const [result] = await db.insert(gptCategories).values(category).returning();
    return result;
  }

  async getGptCategories(): Promise<GptCategory[]> {
    return db.select().from(gptCategories).orderBy(gptCategories.sortOrder);
  }

  // GPT Version operations
  async createGptVersion(version: InsertGptVersion): Promise<GptVersion> {
    const [result] = await db.insert(gptVersions).values(version).returning();
    return result;
  }

  async getGptVersions(gptId: string): Promise<GptVersion[]> {
    return db.select().from(gptVersions).where(eq(gptVersions.gptId, gptId)).orderBy(desc(gptVersions.versionNumber));
  }

  async getLatestGptVersion(gptId: string): Promise<GptVersion | undefined> {
    const [result] = await db.select().from(gptVersions)
      .where(eq(gptVersions.gptId, gptId))
      .orderBy(desc(gptVersions.versionNumber))
      .limit(1);
    return result;
  }

  // Admin: User management
  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [result] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return result;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getUserStats(): Promise<{ total: number; active: number; newThisMonth: number }> {
    const allUsers = await db.select().from(users);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const total = allUsers.length;
    const active = allUsers.filter(u => u.status === "active").length;
    const newThisMonth = allUsers.filter(u => u.createdAt && u.createdAt >= monthStart).length;
    return { total, active, newThisMonth };
  }

  // Admin: AI Models
  async createAiModel(model: InsertAiModel): Promise<AiModel> {
    const [result] = await db.insert(aiModels).values(model).returning();
    return result;
  }

  async getAiModels(): Promise<AiModel[]> {
    return db.select().from(aiModels).orderBy(desc(aiModels.createdAt));
  }

  async updateAiModel(id: string, updates: Partial<InsertAiModel>): Promise<AiModel | undefined> {
    const [result] = await db.update(aiModels).set(updates).where(eq(aiModels.id, id)).returning();
    return result;
  }

  async deleteAiModel(id: string): Promise<void> {
    await db.delete(aiModels).where(eq(aiModels.id, id));
  }

  // Admin: Payments
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [result] = await db.insert(payments).values(payment).returning();
    return result;
  }

  async getPayments(): Promise<Payment[]> {
    return db.select().from(payments).orderBy(desc(payments.createdAt));
  }

  async updatePayment(id: string, updates: Partial<InsertPayment>): Promise<Payment | undefined> {
    const [result] = await db.update(payments).set(updates).where(eq(payments.id, id)).returning();
    return result;
  }

  async getPaymentStats(): Promise<{ total: string; thisMonth: string; count: number }> {
    const allPayments = await db.select().from(payments);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const completedPayments = allPayments.filter(p => p.status === "completed");
    const thisMonthPayments = completedPayments.filter(p => p.createdAt >= monthStart);
    const total = completedPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const thisMonth = thisMonthPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    return { total: total.toFixed(2), thisMonth: thisMonth.toFixed(2), count: completedPayments.length };
  }

  // Admin: Invoices
  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [result] = await db.insert(invoices).values(invoice).returning();
    return result;
  }

  async getInvoices(): Promise<Invoice[]> {
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async updateInvoice(id: string, updates: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [result] = await db.update(invoices).set(updates).where(eq(invoices.id, id)).returning();
    return result;
  }

  // Admin: Settings
  async getSetting(key: string): Promise<PlatformSetting | undefined> {
    const [result] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
    return result;
  }

  async getSettings(): Promise<PlatformSetting[]> {
    return db.select().from(platformSettings).orderBy(platformSettings.category);
  }

  async upsertSetting(key: string, value: string, description?: string, category?: string): Promise<PlatformSetting> {
    const existing = await this.getSetting(key);
    if (existing) {
      const [result] = await db.update(platformSettings)
        .set({ value, description, category, updatedAt: new Date() })
        .where(eq(platformSettings.key, key))
        .returning();
      return result;
    }
    const [result] = await db.insert(platformSettings)
      .values({ key, value, description, category })
      .returning();
    return result;
  }

  // Admin: Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [result] = await db.insert(auditLogs).values(log).returning();
    return result;
  }

  async getAuditLogs(limit: number = 100): Promise<AuditLog[]> {
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // Admin: Analytics
  async createAnalyticsSnapshot(snapshot: InsertAnalyticsSnapshot): Promise<AnalyticsSnapshot> {
    const [result] = await db.insert(analyticsSnapshots).values(snapshot).returning();
    return result;
  }

  async getAnalyticsSnapshots(days: number = 30): Promise<AnalyticsSnapshot[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return db.select().from(analyticsSnapshots)
      .where(sql`${analyticsSnapshots.date} >= ${cutoff}`)
      .orderBy(analyticsSnapshots.date);
  }

  async getDashboardMetrics(): Promise<{ users: number; queries: number; revenue: string; uptime: number }> {
    const userStats = await this.getUserStats();
    const paymentStats = await this.getPaymentStats();
    const allUsers = await db.select().from(users);
    const totalQueries = allUsers.reduce((sum, u) => sum + (u.queryCount || 0), 0);
    return {
      users: userStats.total,
      queries: totalQueries,
      revenue: paymentStats.total,
      uptime: 99.9
    };
  }

  // Admin: Reports
  async createReport(report: InsertReport): Promise<Report> {
    const [result] = await db.insert(reports).values(report).returning();
    return result;
  }

  async getReports(): Promise<Report[]> {
    return db.select().from(reports).orderBy(desc(reports.createdAt));
  }

  async updateReport(id: string, updates: Partial<InsertReport>): Promise<Report | undefined> {
    const [result] = await db.update(reports).set(updates).where(eq(reports.id, id)).returning();
    return result;
  }

  // Admin: Domain Policies
  async getDomainPolicies(): Promise<DomainPolicy[]> {
    return db.select().from(domainPolicies).orderBy(desc(domainPolicies.createdAt));
  }

  async updateDomainPolicy(id: string, updates: Partial<InsertDomainPolicy>): Promise<DomainPolicy | undefined> {
    const [result] = await db.update(domainPolicies).set(updates).where(eq(domainPolicies.id, id)).returning();
    return result;
  }

  async deleteDomainPolicy(id: string): Promise<void> {
    await db.delete(domainPolicies).where(eq(domainPolicies.id, id));
  }

  // Library Items CRUD
  async createLibraryItem(item: InsertLibraryItem): Promise<LibraryItem> {
    const [result] = await db.insert(libraryItems).values(item).returning();
    return result;
  }

  async getLibraryItems(userId: string, mediaType?: string): Promise<LibraryItem[]> {
    if (mediaType) {
      return db.select().from(libraryItems)
        .where(sql`${libraryItems.userId} = ${userId} AND ${libraryItems.mediaType} = ${mediaType}`)
        .orderBy(desc(libraryItems.createdAt));
    }
    return db.select().from(libraryItems)
      .where(eq(libraryItems.userId, userId))
      .orderBy(desc(libraryItems.createdAt));
  }

  async getLibraryItem(id: string, userId: string): Promise<LibraryItem | null> {
    const [result] = await db.select().from(libraryItems)
      .where(sql`${libraryItems.id} = ${id} AND ${libraryItems.userId} = ${userId}`);
    return result || null;
  }

  async deleteLibraryItem(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(libraryItems)
      .where(sql`${libraryItems.id} = ${id} AND ${libraryItems.userId} = ${userId}`)
      .returning();
    return result.length > 0;
  }

  // Notification Preferences
  async getNotificationEventTypes(): Promise<NotificationEventType[]> {
    return db.select().from(notificationEventTypes).orderBy(notificationEventTypes.sortOrder);
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreference[]> {
    return db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }

  async upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await db.select().from(notificationPreferences)
      .where(sql`${notificationPreferences.userId} = ${pref.userId} AND ${notificationPreferences.eventTypeId} = ${pref.eventTypeId}`);
    if (existing.length > 0) {
      const [updated] = await db.update(notificationPreferences)
        .set({ ...pref, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(notificationPreferences).values(pref).returning();
    return created;
  }

  // User Settings
  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const [result] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return result || null;
  }

  async upsertUserSettings(userId: string, settings: Partial<InsertUserSettings>): Promise<UserSettings> {
    const defaultFeatureFlags = {
      memoryEnabled: true,
      recordingHistoryEnabled: false,
      webSearchAuto: true,
      codeInterpreterEnabled: true,
      canvasEnabled: true,
      voiceEnabled: true,
      voiceAdvanced: false,
      connectorSearchAuto: false
    };

    const defaultResponsePreferences = {
      responseStyle: 'default' as const,
      responseTone: 'professional',
      customInstructions: ''
    };

    const defaultUserProfile = {
      nickname: '',
      occupation: '',
      bio: ''
    };

    const defaultPrivacySettings = {
      trainingOptIn: false,
      remoteBrowserDataAccess: false
    };

    const existing = await this.getUserSettings(userId);
    
    if (existing) {
      const mergedSettings = {
        responsePreferences: settings.responsePreferences 
          ? { ...existing.responsePreferences, ...settings.responsePreferences }
          : existing.responsePreferences,
        userProfile: settings.userProfile
          ? { ...existing.userProfile, ...settings.userProfile }
          : existing.userProfile,
        featureFlags: settings.featureFlags
          ? { ...existing.featureFlags, ...settings.featureFlags }
          : existing.featureFlags,
        privacySettings: settings.privacySettings
          ? { ...existing.privacySettings, ...settings.privacySettings }
          : existing.privacySettings,
        updatedAt: new Date()
      };
      
      const [updated] = await db.update(userSettings)
        .set(mergedSettings)
        .where(eq(userSettings.userId, userId))
        .returning();
      return updated;
    }

    const newSettings: InsertUserSettings = {
      userId,
      responsePreferences: settings.responsePreferences 
        ? { ...defaultResponsePreferences, ...settings.responsePreferences }
        : defaultResponsePreferences,
      userProfile: settings.userProfile
        ? { ...defaultUserProfile, ...settings.userProfile }
        : defaultUserProfile,
      featureFlags: settings.featureFlags
        ? { ...defaultFeatureFlags, ...settings.featureFlags }
        : defaultFeatureFlags,
      privacySettings: settings.privacySettings
        ? { ...defaultPrivacySettings, ...settings.privacySettings }
        : defaultPrivacySettings
    };

    const [created] = await db.insert(userSettings).values(newSettings).returning();
    return created;
  }

  // Integration Management
  async getIntegrationProviders(): Promise<IntegrationProvider[]> {
    return db.select().from(integrationProviders).orderBy(integrationProviders.name);
  }

  async getIntegrationProvider(id: string): Promise<IntegrationProvider | null> {
    const [result] = await db.select().from(integrationProviders).where(eq(integrationProviders.id, id));
    return result || null;
  }

  async createIntegrationProvider(provider: InsertIntegrationProvider): Promise<IntegrationProvider> {
    const [result] = await db.insert(integrationProviders).values(provider).returning();
    return result;
  }

  async getIntegrationAccounts(userId: string): Promise<IntegrationAccount[]> {
    return db.select().from(integrationAccounts)
      .where(eq(integrationAccounts.userId, userId))
      .orderBy(desc(integrationAccounts.createdAt));
  }

  async getIntegrationAccount(id: string): Promise<IntegrationAccount | null> {
    const [result] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.id, id));
    return result || null;
  }

  async getIntegrationAccountByProvider(userId: string, providerId: string): Promise<IntegrationAccount | null> {
    const [result] = await db.select().from(integrationAccounts)
      .where(sql`${integrationAccounts.userId} = ${userId} AND ${integrationAccounts.providerId} = ${providerId}`);
    return result || null;
  }

  async createIntegrationAccount(account: InsertIntegrationAccount): Promise<IntegrationAccount> {
    const [result] = await db.insert(integrationAccounts).values(account).returning();
    return result;
  }

  async updateIntegrationAccount(id: string, updates: Partial<InsertIntegrationAccount>): Promise<IntegrationAccount | null> {
    const [result] = await db.update(integrationAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(integrationAccounts.id, id))
      .returning();
    return result || null;
  }

  async deleteIntegrationAccount(id: string): Promise<void> {
    await db.delete(integrationAccounts).where(eq(integrationAccounts.id, id));
  }

  async getIntegrationTools(providerId?: string): Promise<IntegrationTool[]> {
    if (providerId) {
      return db.select().from(integrationTools)
        .where(eq(integrationTools.providerId, providerId))
        .orderBy(integrationTools.name);
    }
    return db.select().from(integrationTools).orderBy(integrationTools.name);
  }

  async getIntegrationPolicy(userId: string): Promise<IntegrationPolicy | null> {
    const [result] = await db.select().from(integrationPolicies).where(eq(integrationPolicies.userId, userId));
    return result || null;
  }

  async upsertIntegrationPolicy(userId: string, policy: Partial<InsertIntegrationPolicy>): Promise<IntegrationPolicy> {
    const existing = await this.getIntegrationPolicy(userId);
    
    if (existing) {
      const mergedPolicy = {
        enabledApps: policy.enabledApps 
          ? Array.from(new Set([...(existing.enabledApps || []), ...policy.enabledApps]))
          : existing.enabledApps,
        enabledTools: policy.enabledTools
          ? Array.from(new Set([...(existing.enabledTools || []), ...policy.enabledTools]))
          : existing.enabledTools,
        disabledTools: policy.disabledTools
          ? Array.from(new Set([...(existing.disabledTools || []), ...policy.disabledTools]))
          : existing.disabledTools,
        resourceScopes: policy.resourceScopes ?? existing.resourceScopes,
        autoConfirmPolicy: policy.autoConfirmPolicy ?? existing.autoConfirmPolicy,
        sandboxMode: policy.sandboxMode ?? existing.sandboxMode,
        maxParallelCalls: policy.maxParallelCalls ?? existing.maxParallelCalls,
        updatedAt: new Date()
      };
      
      const [updated] = await db.update(integrationPolicies)
        .set(mergedPolicy)
        .where(eq(integrationPolicies.userId, userId))
        .returning();
      return updated;
    }

    const newPolicy: InsertIntegrationPolicy = {
      userId,
      enabledApps: policy.enabledApps || [],
      enabledTools: policy.enabledTools || [],
      disabledTools: policy.disabledTools || [],
      resourceScopes: policy.resourceScopes,
      autoConfirmPolicy: policy.autoConfirmPolicy || 'ask',
      sandboxMode: policy.sandboxMode || 'false',
      maxParallelCalls: policy.maxParallelCalls || 3
    };

    const [created] = await db.insert(integrationPolicies).values(newPolicy).returning();
    return created;
  }

  async createToolCallLog(log: InsertToolCallLog): Promise<ToolCallLog> {
    const [result] = await db.insert(toolCallLogs).values(log).returning();
    return result;
  }

  async getToolCallLogs(userId: string, limit: number = 100): Promise<ToolCallLog[]> {
    return db.select().from(toolCallLogs)
      .where(eq(toolCallLogs.userId, userId))
      .orderBy(desc(toolCallLogs.createdAt))
      .limit(limit);
  }

  // Consent Logs
  async logConsent(userId: string, consentType: string, value: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await db.insert(consentLogs).values({
      userId,
      consentType,
      value,
      ipAddress,
      userAgent,
    });
  }

  async getConsentLogs(userId: string, limit: number = 50): Promise<ConsentLog[]> {
    return db.select().from(consentLogs)
      .where(eq(consentLogs.userId, userId))
      .orderBy(desc(consentLogs.createdAt))
      .limit(limit);
  }

  // Shared Links CRUD
  async createSharedLink(data: InsertSharedLink): Promise<SharedLink> {
    const token = data.token || crypto.randomBytes(32).toString('hex');
    const [result] = await db.insert(sharedLinks).values({ ...data, token }).returning();
    return result;
  }

  async getSharedLinks(userId: string): Promise<SharedLink[]> {
    return db.select().from(sharedLinks)
      .where(eq(sharedLinks.userId, userId))
      .orderBy(desc(sharedLinks.createdAt));
  }

  async getSharedLinkByToken(token: string): Promise<SharedLink | undefined> {
    const [result] = await db.select().from(sharedLinks).where(eq(sharedLinks.token, token));
    return result;
  }

  async updateSharedLink(id: string, data: Partial<InsertSharedLink>): Promise<SharedLink> {
    const [result] = await db.update(sharedLinks)
      .set(data)
      .where(eq(sharedLinks.id, id))
      .returning();
    return result;
  }

  async revokeSharedLink(id: string): Promise<void> {
    await db.update(sharedLinks)
      .set({ isRevoked: 'true' })
      .where(eq(sharedLinks.id, id));
  }

  async rotateSharedLinkToken(id: string): Promise<SharedLink> {
    const newToken = crypto.randomBytes(32).toString('hex');
    const [result] = await db.update(sharedLinks)
      .set({ token: newToken })
      .where(eq(sharedLinks.id, id))
      .returning();
    return result;
  }

  async incrementSharedLinkAccess(id: string): Promise<void> {
    await db.update(sharedLinks)
      .set({ 
        accessCount: sql`${sharedLinks.accessCount} + 1`,
        lastAccessedAt: new Date()
      })
      .where(eq(sharedLinks.id, id));
  }

  // Archived/Deleted Chats
  async getArchivedChats(userId: string): Promise<Chat[]> {
    return db.select().from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.archived, 'true')))
      .orderBy(desc(chats.updatedAt));
  }

  async unarchiveChat(chatId: string): Promise<void> {
    await db.update(chats)
      .set({ archived: 'false', updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async archiveAllChats(userId: string): Promise<number> {
    const result = await db.update(chats)
      .set({ archived: 'true', updatedAt: new Date() })
      .where(and(eq(chats.userId, userId), eq(chats.archived, 'false')))
      .returning();
    return result.length;
  }

  async softDeleteChat(chatId: string): Promise<void> {
    await db.update(chats)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async softDeleteAllChats(userId: string): Promise<number> {
    const result = await db.update(chats)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
      .returning();
    return result.length;
  }

  async getDeletedChats(userId: string): Promise<Chat[]> {
    return db.select().from(chats)
      .where(and(eq(chats.userId, userId), sql`${chats.deletedAt} IS NOT NULL`))
      .orderBy(desc(chats.deletedAt));
  }

  async restoreDeletedChat(chatId: string): Promise<void> {
    await db.update(chats)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async permanentlyDeleteChat(chatId: string): Promise<void> {
    await db.delete(chats).where(eq(chats.id, chatId));
  }

  // Company Knowledge
  async getCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]> {
    return db.select().from(companyKnowledge)
      .where(eq(companyKnowledge.userId, userId))
      .orderBy(desc(companyKnowledge.createdAt));
  }

  async getActiveCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]> {
    return db.select().from(companyKnowledge)
      .where(and(eq(companyKnowledge.userId, userId), eq(companyKnowledge.isActive, 'true')))
      .orderBy(desc(companyKnowledge.createdAt));
  }

  async createCompanyKnowledge(knowledge: InsertCompanyKnowledge): Promise<CompanyKnowledge> {
    const [result] = await db.insert(companyKnowledge).values(knowledge).returning();
    return result;
  }

  async updateCompanyKnowledge(id: string, updates: Partial<InsertCompanyKnowledge>): Promise<CompanyKnowledge | null> {
    const [result] = await db.update(companyKnowledge)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companyKnowledge.id, id))
      .returning();
    return result || null;
  }

  async deleteCompanyKnowledge(id: string): Promise<void> {
    await db.delete(companyKnowledge).where(eq(companyKnowledge.id, id));
  }

  // Gmail OAuth Token operations (Custom MCP)
  async getGmailOAuthToken(userId: string): Promise<GmailOAuthToken | null> {
    const [token] = await db.select().from(gmailOAuthTokens)
      .where(eq(gmailOAuthTokens.userId, userId));
    return token || null;
  }

  async saveGmailOAuthToken(token: InsertGmailOAuthToken): Promise<GmailOAuthToken> {
    const existing = await this.getGmailOAuthToken(token.userId);
    if (existing) {
      const [updated] = await db.update(gmailOAuthTokens)
        .set({ ...token, updatedAt: new Date() })
        .where(eq(gmailOAuthTokens.userId, token.userId))
        .returning();
      return updated;
    }
    const [result] = await db.insert(gmailOAuthTokens).values(token).returning();
    return result;
  }

  async updateGmailOAuthToken(userId: string, updates: Partial<InsertGmailOAuthToken>): Promise<GmailOAuthToken | null> {
    const [result] = await db.update(gmailOAuthTokens)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(gmailOAuthTokens.userId, userId))
      .returning();
    return result || null;
  }

  async deleteGmailOAuthToken(userId: string): Promise<void> {
    await db.delete(gmailOAuthTokens).where(eq(gmailOAuthTokens.userId, userId));
  }

  // Message Idempotency operations
  async findMessageByRequestId(requestId: string): Promise<ChatMessage | null> {
    const [message] = await db.select().from(chatMessages)
      .where(eq(chatMessages.requestId, requestId));
    return message || null;
  }

  async claimPendingMessage(messageId: string): Promise<ChatMessage | null> {
    const [result] = await db.update(chatMessages)
      .set({ status: 'processing' })
      .where(and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.status, 'pending')
      ))
      .returning();
    return result || null;
  }

  async updateMessageStatus(messageId: string, status: 'pending' | 'processing' | 'done' | 'failed'): Promise<ChatMessage | null> {
    const [result] = await db.update(chatMessages)
      .set({ status })
      .where(eq(chatMessages.id, messageId))
      .returning();
    return result || null;
  }

  async updateMessageContent(messageId: string, content: string, additionalData?: Partial<InsertChatMessage>): Promise<ChatMessage | null> {
    const [result] = await db.update(chatMessages)
      .set({ content, ...additionalData })
      .where(eq(chatMessages.id, messageId))
      .returning();
    return result || null;
  }

  async findAssistantResponseForUserMessage(userMessageId: string): Promise<ChatMessage | null> {
    const [message] = await db.select().from(chatMessages)
      .where(and(
        eq(chatMessages.userMessageId, userMessageId),
        eq(chatMessages.role, 'assistant')
      ));
    return message || null;
  }

  // Response Quality Metrics
  async recordQualityMetric(metric: InsertResponseQualityMetric): Promise<ResponseQualityMetric> {
    const [result] = await db.insert(responseQualityMetrics).values(metric).returning();
    return result;
  }

  async getQualityMetrics(since: Date, limit: number = 100): Promise<ResponseQualityMetric[]> {
    return db.select().from(responseQualityMetrics)
      .where(sql`${responseQualityMetrics.createdAt} >= ${since}`)
      .orderBy(desc(responseQualityMetrics.createdAt))
      .limit(limit);
  }

  // Connector Usage Hourly
  async upsertConnectorUsage(connector: string, hourBucket: Date, success: boolean, latencyMs: number): Promise<ConnectorUsageHourly> {
    const roundedHour = new Date(hourBucket);
    roundedHour.setMinutes(0, 0, 0);

    const existing = await db.select().from(connectorUsageHourly)
      .where(and(
        eq(connectorUsageHourly.connector, connector),
        eq(connectorUsageHourly.hourBucket, roundedHour)
      ));

    if (existing.length > 0) {
      const current = existing[0];
      const [updated] = await db.update(connectorUsageHourly)
        .set({
          totalCalls: (current.totalCalls || 0) + 1,
          successCount: success ? (current.successCount || 0) + 1 : current.successCount,
          failureCount: !success ? (current.failureCount || 0) + 1 : current.failureCount,
          totalLatencyMs: (current.totalLatencyMs || 0) + latencyMs,
        })
        .where(eq(connectorUsageHourly.id, current.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(connectorUsageHourly).values({
      connector,
      hourBucket: roundedHour,
      totalCalls: 1,
      successCount: success ? 1 : 0,
      failureCount: !success ? 1 : 0,
      totalLatencyMs: latencyMs,
    }).returning();
    return created;
  }

  async getConnectorUsageStats(connector: string, since: Date): Promise<ConnectorUsageHourly[]> {
    return db.select().from(connectorUsageHourly)
      .where(and(
        eq(connectorUsageHourly.connector, connector),
        sql`${connectorUsageHourly.createdAt} >= ${since}`
      ))
      .orderBy(desc(connectorUsageHourly.hourBucket));
  }

  // Offline Message Queue
  async createOfflineMessage(message: InsertOfflineMessageQueue): Promise<OfflineMessageQueue> {
    const [result] = await db.insert(offlineMessageQueue).values(message).returning();
    return result;
  }

  async getOfflineMessages(userId: string, status?: string): Promise<OfflineMessageQueue[]> {
    if (status) {
      return db.select().from(offlineMessageQueue)
        .where(and(
          eq(offlineMessageQueue.userId, userId),
          eq(offlineMessageQueue.status, status)
        ))
        .orderBy(offlineMessageQueue.createdAt);
    }
    return db.select().from(offlineMessageQueue)
      .where(eq(offlineMessageQueue.userId, userId))
      .orderBy(offlineMessageQueue.createdAt);
  }

  async updateOfflineMessageStatus(id: string, status: string, error?: string): Promise<OfflineMessageQueue | null> {
    const updates: Partial<OfflineMessageQueue> = { status };
    if (error) {
      updates.error = error;
      updates.retryCount = sql`${offlineMessageQueue.retryCount} + 1` as any;
    }
    const [result] = await db.update(offlineMessageQueue)
      .set(updates)
      .where(eq(offlineMessageQueue.id, id))
      .returning();
    return result || null;
  }

  async syncOfflineMessage(id: string): Promise<OfflineMessageQueue | null> {
    const [result] = await db.update(offlineMessageQueue)
      .set({ status: 'synced', syncedAt: new Date() })
      .where(eq(offlineMessageQueue.id, id))
      .returning();
    return result || null;
  }

  // Chat Stats
  async updateChatMessageStats(chatId: string): Promise<Chat | undefined> {
    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(desc(chatMessages.createdAt));
    
    const messageCount = messages.length;
    const lastMessageAt = messages.length > 0 ? messages[0].createdAt : null;

    const [result] = await db.update(chats)
      .set({ 
        messageCount, 
        lastMessageAt,
        updatedAt: new Date() 
      })
      .where(eq(chats.id, chatId))
      .returning();
    return result;
  }
}

export const storage = new MemStorage();
