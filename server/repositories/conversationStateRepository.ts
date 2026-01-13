import { db } from "../db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  conversationStates,
  conversationStateVersions,
  conversationMessages,
  conversationArtifacts,
  conversationImages,
  conversationContexts,
  InsertConversationState,
  InsertConversationMessage,
  InsertConversationArtifact,
  InsertConversationImage,
  InsertConversationContext,
  InsertConversationStateVersion,
  ConversationState,
  ConversationMessage,
  ConversationArtifact,
  ConversationImage,
  ConversationContext,
  ConversationStateVersion,
  HydratedConversationState,
} from "@shared/schema";

export class ConversationStateRepository {
  async findByChatId(chatId: string): Promise<ConversationState | null> {
    const [state] = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.chatId, chatId))
      .limit(1);
    return state || null;
  }

  async findById(id: string): Promise<ConversationState | null> {
    const [state] = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.id, id))
      .limit(1);
    return state || null;
  }

  async create(data: InsertConversationState): Promise<ConversationState> {
    const [state] = await db
      .insert(conversationStates)
      .values(data)
      .returning();
    return state;
  }

  async update(id: string, data: Partial<InsertConversationState>): Promise<ConversationState> {
    const [state] = await db
      .update(conversationStates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(conversationStates.id, id))
      .returning();
    return state;
  }

  async incrementVersion(id: string): Promise<ConversationState> {
    const [state] = await db
      .update(conversationStates)
      .set({
        version: sql`${conversationStates.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, id))
      .returning();
    return state;
  }

  async getOrCreate(chatId: string, userId?: string): Promise<ConversationState> {
    const existing = await this.findByChatId(chatId);
    if (existing) return existing;

    return this.create({
      chatId,
      userId: userId || null,
      version: 1,
      totalTokens: 0,
      messageCount: 0,
      artifactCount: 0,
      imageCount: 0,
    });
  }

  async addMessage(data: InsertConversationMessage): Promise<ConversationMessage> {
    const [message] = await db
      .insert(conversationMessages)
      .values(data)
      .returning();

    await db
      .update(conversationStates)
      .set({
        messageCount: sql`${conversationStates.messageCount} + 1`,
        lastMessageId: message.id,
        totalTokens: sql`${conversationStates.totalTokens} + ${data.tokenCount || 0}`,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, data.stateId));

    return message;
  }

  async getMessages(stateId: string): Promise<ConversationMessage[]> {
    return db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.stateId, stateId))
      .orderBy(asc(conversationMessages.sequence));
  }

  async addArtifact(data: InsertConversationArtifact): Promise<ConversationArtifact> {
    const [artifact] = await db
      .insert(conversationArtifacts)
      .values(data)
      .returning();

    await db
      .update(conversationStates)
      .set({
        artifactCount: sql`${conversationStates.artifactCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, data.stateId));

    return artifact;
  }

  async getArtifacts(stateId: string): Promise<ConversationArtifact[]> {
    return db
      .select()
      .from(conversationArtifacts)
      .where(eq(conversationArtifacts.stateId, stateId))
      .orderBy(desc(conversationArtifacts.createdAt));
  }

  async findArtifactByChecksum(stateId: string, checksum: string): Promise<ConversationArtifact | null> {
    const [artifact] = await db
      .select()
      .from(conversationArtifacts)
      .where(
        and(
          eq(conversationArtifacts.stateId, stateId),
          eq(conversationArtifacts.checksum, checksum)
        )
      )
      .limit(1);
    return artifact || null;
  }

  async addImage(data: InsertConversationImage): Promise<ConversationImage> {
    if (data.parentImageId) {
      await db
        .update(conversationImages)
        .set({ isLatest: "false" })
        .where(eq(conversationImages.id, data.parentImageId));
    }

    const [image] = await db
      .insert(conversationImages)
      .values({ ...data, isLatest: "true" })
      .returning();

    await db
      .update(conversationStates)
      .set({
        imageCount: sql`${conversationStates.imageCount} + 1`,
        lastImageId: image.id,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, data.stateId));

    return image;
  }

  async getImages(stateId: string): Promise<ConversationImage[]> {
    return db
      .select()
      .from(conversationImages)
      .where(eq(conversationImages.stateId, stateId))
      .orderBy(desc(conversationImages.createdAt));
  }

  async getLatestImage(stateId: string): Promise<ConversationImage | null> {
    const [image] = await db
      .select()
      .from(conversationImages)
      .where(
        and(
          eq(conversationImages.stateId, stateId),
          eq(conversationImages.isLatest, "true")
        )
      )
      .limit(1);
    return image || null;
  }

  async getImageEditChain(imageId: string): Promise<ConversationImage[]> {
    const chain: ConversationImage[] = [];
    let currentId: string | null = imageId;

    while (currentId) {
      const [image] = await db
        .select()
        .from(conversationImages)
        .where(eq(conversationImages.id, currentId))
        .limit(1);

      if (!image) break;
      chain.unshift(image);
      currentId = image.parentImageId;
    }

    return chain;
  }

  async upsertContext(data: InsertConversationContext): Promise<ConversationContext> {
    const existing = await this.getContext(data.stateId);
    
    if (existing) {
      const [context] = await db
        .update(conversationContexts)
        .set({
          ...data,
          lastUpdatedAt: new Date(),
        })
        .where(eq(conversationContexts.stateId, data.stateId))
        .returning();
      return context;
    }

    const [context] = await db
      .insert(conversationContexts)
      .values(data)
      .returning();
    return context;
  }

  async getContext(stateId: string): Promise<ConversationContext | null> {
    const [context] = await db
      .select()
      .from(conversationContexts)
      .where(eq(conversationContexts.stateId, stateId))
      .limit(1);
    return context || null;
  }

  async createSnapshot(
    stateId: string,
    version: number,
    snapshot: object,
    changeDescription?: string,
    authorId?: string
  ): Promise<ConversationStateVersion> {
    const [versionRecord] = await db
      .insert(conversationStateVersions)
      .values({
        stateId,
        version,
        snapshot,
        changeDescription,
        authorId,
      })
      .returning();
    return versionRecord;
  }

  async getVersions(stateId: string): Promise<ConversationStateVersion[]> {
    return db
      .select()
      .from(conversationStateVersions)
      .where(eq(conversationStateVersions.stateId, stateId))
      .orderBy(desc(conversationStateVersions.version));
  }

  async getVersion(stateId: string, version: number): Promise<ConversationStateVersion | null> {
    const [versionRecord] = await db
      .select()
      .from(conversationStateVersions)
      .where(
        and(
          eq(conversationStateVersions.stateId, stateId),
          eq(conversationStateVersions.version, version)
        )
      )
      .limit(1);
    return versionRecord || null;
  }

  async hydrate(chatId: string): Promise<HydratedConversationState | null> {
    const state = await this.findByChatId(chatId);
    if (!state) return null;

    const [messages, artifacts, images, context] = await Promise.all([
      this.getMessages(state.id),
      this.getArtifacts(state.id),
      this.getImages(state.id),
      this.getContext(state.id),
    ]);

    return {
      id: state.id,
      chatId: state.chatId,
      userId: state.userId,
      version: state.version,
      totalTokens: state.totalTokens || 0,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokenCount: m.tokenCount || 0,
        sequence: m.sequence,
        attachmentIds: m.attachmentIds || [],
        imageIds: m.imageIds || [],
        createdAt: m.createdAt.toISOString(),
      })),
      artifacts: artifacts.map((a) => ({
        id: a.id,
        artifactType: a.artifactType,
        mimeType: a.mimeType,
        fileName: a.fileName,
        fileSize: a.fileSize,
        checksum: a.checksum,
        storageUrl: a.storageUrl,
        extractedText: a.extractedText,
        metadata: a.metadata,
        processingStatus: a.processingStatus,
        createdAt: a.createdAt.toISOString(),
      })),
      images: images.map((i) => ({
        id: i.id,
        parentImageId: i.parentImageId,
        prompt: i.prompt,
        imageUrl: i.imageUrl,
        thumbnailUrl: i.thumbnailUrl,
        model: i.model,
        mode: i.mode,
        editHistory: i.editHistory || [],
        isLatest: i.isLatest,
        createdAt: i.createdAt.toISOString(),
      })),
      context: context
        ? {
            summary: context.summary,
            entities: (context.entities as any[]) || [],
            userPreferences: (context.userPreferences as Record<string, unknown>) || {},
            topics: context.topics || [],
            sentiment: context.sentiment,
          }
        : null,
      lastMessageId: state.lastMessageId,
      lastImageId: state.lastImageId,
      createdAt: state.createdAt.toISOString(),
      updatedAt: state.updatedAt.toISOString(),
    };
  }

  async delete(chatId: string): Promise<void> {
    await db
      .delete(conversationStates)
      .where(eq(conversationStates.chatId, chatId));
  }
}

export const conversationStateRepository = new ConversationStateRepository();
