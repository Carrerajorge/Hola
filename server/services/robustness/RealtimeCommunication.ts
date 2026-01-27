/**
 * Realtime Communication Service
 *
 * Robust WebSocket handling and real-time messaging.
 * Implements improvements 146-160: Realtime Communication
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface Connection {
    id: string;
    userId?: string;
    socket: any; // WebSocket-like interface
    connectedAt: Date;
    lastActivity: Date;
    subscriptions: Set<string>;
    metadata: Record<string, any>;
    state: "connecting" | "connected" | "disconnecting" | "disconnected";
}

interface Message {
    id: string;
    type: string;
    channel: string;
    payload: any;
    timestamp: Date;
    sender?: string;
    priority: "low" | "normal" | "high";
}

interface Channel {
    name: string;
    subscribers: Set<string>;
    createdAt: Date;
    messageCount: number;
    lastMessage?: Date;
    config: {
        persistent: boolean;
        maxHistory: number;
        requireAuth: boolean;
    };
}

interface DeliveryReceipt {
    messageId: string;
    connectionId: string;
    status: "sent" | "delivered" | "failed";
    timestamp: Date;
    error?: string;
}

// ============================================================================
// CONNECTION MANAGER (Improvements 146-148)
// ============================================================================

class ConnectionManager extends EventEmitter {
    private connections: Map<string, Connection> = new Map();
    private userConnections: Map<string, Set<string>> = new Map();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly heartbeatMs = 30000;
    private readonly timeoutMs = 90000;

    startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.checkConnections();
        }, this.heartbeatMs);
    }

    stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    addConnection(socket: any, userId?: string, metadata: Record<string, any> = {}): Connection {
        const connection: Connection = {
            id: crypto.randomUUID(),
            userId,
            socket,
            connectedAt: new Date(),
            lastActivity: new Date(),
            subscriptions: new Set(),
            metadata,
            state: "connected"
        };

        this.connections.set(connection.id, connection);

        if (userId) {
            if (!this.userConnections.has(userId)) {
                this.userConnections.set(userId, new Set());
            }
            this.userConnections.get(userId)!.add(connection.id);
        }

        this.emit("connection_added", { connectionId: connection.id, userId });
        console.log(`[ConnectionManager] Connection added: ${connection.id}`);

        return connection;
    }

    removeConnection(connectionId: string): void {
        const connection = this.connections.get(connectionId);
        if (!connection) return;

        connection.state = "disconnected";

        if (connection.userId) {
            const userConns = this.userConnections.get(connection.userId);
            if (userConns) {
                userConns.delete(connectionId);
                if (userConns.size === 0) {
                    this.userConnections.delete(connection.userId);
                }
            }
        }

        this.connections.delete(connectionId);
        this.emit("connection_removed", { connectionId, userId: connection.userId });
        console.log(`[ConnectionManager] Connection removed: ${connectionId}`);
    }

    getConnection(connectionId: string): Connection | undefined {
        return this.connections.get(connectionId);
    }

    getConnectionsByUser(userId: string): Connection[] {
        const connectionIds = this.userConnections.get(userId) || new Set();
        return Array.from(connectionIds)
            .map(id => this.connections.get(id))
            .filter((c): c is Connection => c !== undefined);
    }

    updateActivity(connectionId: string): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.lastActivity = new Date();
        }
    }

    private checkConnections(): void {
        const now = Date.now();
        const toRemove: string[] = [];

        for (const [id, connection] of this.connections) {
            const inactive = now - connection.lastActivity.getTime();

            if (inactive > this.timeoutMs) {
                console.log(`[ConnectionManager] Timing out connection: ${id}`);
                toRemove.push(id);
            } else if (inactive > this.heartbeatMs) {
                // Send ping
                this.sendPing(connection);
            }
        }

        for (const id of toRemove) {
            this.removeConnection(id);
        }
    }

    private sendPing(connection: Connection): void {
        try {
            if (connection.socket.send) {
                connection.socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
            }
        } catch (error) {
            // Connection might be dead
            console.log(`[ConnectionManager] Ping failed for ${connection.id}`);
        }
    }

    getStats(): {
        totalConnections: number;
        uniqueUsers: number;
        avgConnectionDuration: number;
    } {
        const durations = Array.from(this.connections.values())
            .map(c => Date.now() - c.connectedAt.getTime());

        return {
            totalConnections: this.connections.size,
            uniqueUsers: this.userConnections.size,
            avgConnectionDuration: durations.length > 0
                ? durations.reduce((a, b) => a + b, 0) / durations.length
                : 0
        };
    }
}

// ============================================================================
// CHANNEL MANAGER (Improvements 149-151)
// ============================================================================

class ChannelManager extends EventEmitter {
    private channels: Map<string, Channel> = new Map();
    private messageHistory: Map<string, Message[]> = new Map();

    createChannel(name: string, config: Partial<Channel["config"]> = {}): Channel {
        if (this.channels.has(name)) {
            return this.channels.get(name)!;
        }

        const channel: Channel = {
            name,
            subscribers: new Set(),
            createdAt: new Date(),
            messageCount: 0,
            config: {
                persistent: config.persistent ?? false,
                maxHistory: config.maxHistory ?? 100,
                requireAuth: config.requireAuth ?? false
            }
        };

        this.channels.set(name, channel);
        this.messageHistory.set(name, []);

        console.log(`[ChannelManager] Channel created: ${name}`);
        return channel;
    }

    deleteChannel(name: string): boolean {
        const channel = this.channels.get(name);
        if (!channel) return false;

        // Notify subscribers
        this.emit("channel_deleted", { name, subscribers: Array.from(channel.subscribers) });

        this.channels.delete(name);
        this.messageHistory.delete(name);

        console.log(`[ChannelManager] Channel deleted: ${name}`);
        return true;
    }

    subscribe(channelName: string, connectionId: string): boolean {
        let channel = this.channels.get(channelName);

        if (!channel) {
            // Auto-create channel
            channel = this.createChannel(channelName);
        }

        channel.subscribers.add(connectionId);
        this.emit("subscribed", { channel: channelName, connectionId });

        return true;
    }

    unsubscribe(channelName: string, connectionId: string): boolean {
        const channel = this.channels.get(channelName);
        if (!channel) return false;

        channel.subscribers.delete(connectionId);
        this.emit("unsubscribed", { channel: channelName, connectionId });

        return true;
    }

    unsubscribeAll(connectionId: string): void {
        for (const channel of this.channels.values()) {
            channel.subscribers.delete(connectionId);
        }
    }

    getSubscribers(channelName: string): string[] {
        const channel = this.channels.get(channelName);
        return channel ? Array.from(channel.subscribers) : [];
    }

    addMessage(channelName: string, message: Message): void {
        const channel = this.channels.get(channelName);
        if (!channel) return;

        channel.messageCount++;
        channel.lastMessage = message.timestamp;

        const history = this.messageHistory.get(channelName) || [];
        history.push(message);

        if (history.length > channel.config.maxHistory) {
            history.shift();
        }

        this.messageHistory.set(channelName, history);
    }

    getHistory(channelName: string, limit?: number): Message[] {
        const history = this.messageHistory.get(channelName) || [];
        return limit ? history.slice(-limit) : [...history];
    }

    getChannels(): Channel[] {
        return Array.from(this.channels.values());
    }

    getChannel(name: string): Channel | undefined {
        return this.channels.get(name);
    }
}

// ============================================================================
// MESSAGE BROKER (Improvements 152-154)
// ============================================================================

class MessageBroker extends EventEmitter {
    private connectionManager: ConnectionManager;
    private channelManager: ChannelManager;
    private deliveryQueue: Array<{ message: Message; targets: string[] }> = [];
    private deliveryReceipts: Map<string, DeliveryReceipt[]> = new Map();
    private processing = false;

    constructor(connectionManager: ConnectionManager, channelManager: ChannelManager) {
        super();
        this.connectionManager = connectionManager;
        this.channelManager = channelManager;
    }

    async publish(channel: string, type: string, payload: any, options: {
        sender?: string;
        priority?: Message["priority"];
        persist?: boolean;
    } = {}): Promise<Message> {
        const message: Message = {
            id: crypto.randomUUID(),
            type,
            channel,
            payload,
            timestamp: new Date(),
            sender: options.sender,
            priority: options.priority || "normal"
        };

        // Store in history if channel is persistent
        this.channelManager.addMessage(channel, message);

        // Get subscribers
        const subscribers = this.channelManager.getSubscribers(channel);

        // Queue for delivery
        this.deliveryQueue.push({ message, targets: subscribers });

        // Process queue
        this.processQueue();

        this.emit("message_published", { message, subscriberCount: subscribers.length });

        return message;
    }

    async broadcast(type: string, payload: any, options: {
        sender?: string;
        excludeConnections?: string[];
    } = {}): Promise<void> {
        const message: Message = {
            id: crypto.randomUUID(),
            type,
            channel: "__broadcast__",
            payload,
            timestamp: new Date(),
            sender: options.sender,
            priority: "high"
        };

        const allConnections = Array.from(this.connectionManager["connections"].keys())
            .filter(id => !options.excludeConnections?.includes(id));

        this.deliveryQueue.push({ message, targets: allConnections });
        this.processQueue();
    }

    async sendToUser(userId: string, type: string, payload: any): Promise<boolean> {
        const connections = this.connectionManager.getConnectionsByUser(userId);
        if (connections.length === 0) return false;

        const message: Message = {
            id: crypto.randomUUID(),
            type,
            channel: `__user_${userId}__`,
            payload,
            timestamp: new Date(),
            priority: "normal"
        };

        const targets = connections.map(c => c.id);
        this.deliveryQueue.push({ message, targets });
        this.processQueue();

        return true;
    }

    async sendToConnection(connectionId: string, type: string, payload: any): Promise<boolean> {
        const connection = this.connectionManager.getConnection(connectionId);
        if (!connection) return false;

        const message: Message = {
            id: crypto.randomUUID(),
            type,
            channel: `__direct_${connectionId}__`,
            payload,
            timestamp: new Date(),
            priority: "normal"
        };

        return this.deliverMessage(message, connection);
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        while (this.deliveryQueue.length > 0) {
            // Sort by priority
            this.deliveryQueue.sort((a, b) => {
                const priorityOrder = { high: 0, normal: 1, low: 2 };
                return priorityOrder[a.message.priority] - priorityOrder[b.message.priority];
            });

            const item = this.deliveryQueue.shift();
            if (!item) continue;

            await this.deliverToTargets(item.message, item.targets);
        }

        this.processing = false;
    }

    private async deliverToTargets(message: Message, targets: string[]): Promise<void> {
        const deliveries = targets.map(async (connectionId) => {
            const connection = this.connectionManager.getConnection(connectionId);
            if (!connection) return;

            const success = await this.deliverMessage(message, connection);
            this.recordDelivery(message.id, connectionId, success);
        });

        await Promise.allSettled(deliveries);
    }

    private async deliverMessage(message: Message, connection: Connection): Promise<boolean> {
        try {
            const data = JSON.stringify({
                type: message.type,
                channel: message.channel,
                payload: message.payload,
                timestamp: message.timestamp.toISOString(),
                messageId: message.id
            });

            if (connection.socket.send) {
                connection.socket.send(data);
            } else if (connection.socket.write) {
                connection.socket.write(data);
            }

            this.connectionManager.updateActivity(connection.id);
            return true;
        } catch (error) {
            console.error(`[MessageBroker] Delivery failed to ${connection.id}:`, error);
            return false;
        }
    }

    private recordDelivery(messageId: string, connectionId: string, success: boolean): void {
        const receipt: DeliveryReceipt = {
            messageId,
            connectionId,
            status: success ? "delivered" : "failed",
            timestamp: new Date()
        };

        if (!this.deliveryReceipts.has(messageId)) {
            this.deliveryReceipts.set(messageId, []);
        }

        this.deliveryReceipts.get(messageId)!.push(receipt);

        // Keep only recent receipts
        if (this.deliveryReceipts.size > 10000) {
            const oldest = Array.from(this.deliveryReceipts.keys())[0];
            this.deliveryReceipts.delete(oldest);
        }
    }

    getDeliveryStatus(messageId: string): DeliveryReceipt[] {
        return this.deliveryReceipts.get(messageId) || [];
    }

    getQueueStats(): { pending: number; processing: boolean } {
        return {
            pending: this.deliveryQueue.length,
            processing: this.processing
        };
    }
}

// ============================================================================
// PRESENCE MANAGER (Improvements 155-157)
// ============================================================================

interface PresenceInfo {
    userId: string;
    status: "online" | "away" | "busy" | "offline";
    lastSeen: Date;
    customStatus?: string;
    metadata?: Record<string, any>;
}

class PresenceManager extends EventEmitter {
    private presence: Map<string, PresenceInfo> = new Map();
    private awayTimeout = 300000; // 5 minutes
    private offlineTimeout = 600000; // 10 minutes

    setPresence(userId: string, status: PresenceInfo["status"], customStatus?: string, metadata?: Record<string, any>): void {
        const previous = this.presence.get(userId);

        this.presence.set(userId, {
            userId,
            status,
            lastSeen: new Date(),
            customStatus,
            metadata
        });

        if (!previous || previous.status !== status) {
            this.emit("presence_changed", { userId, status, previousStatus: previous?.status });
        }
    }

    updateActivity(userId: string): void {
        const info = this.presence.get(userId);
        if (info) {
            info.lastSeen = new Date();
            if (info.status === "away") {
                info.status = "online";
                this.emit("presence_changed", { userId, status: "online", previousStatus: "away" });
            }
        }
    }

    getPresence(userId: string): PresenceInfo | null {
        return this.presence.get(userId) || null;
    }

    getOnlineUsers(): PresenceInfo[] {
        return Array.from(this.presence.values())
            .filter(p => p.status !== "offline");
    }

    getUsersInStatus(status: PresenceInfo["status"]): PresenceInfo[] {
        return Array.from(this.presence.values())
            .filter(p => p.status === status);
    }

    checkTimeouts(): void {
        const now = Date.now();

        for (const [userId, info] of this.presence) {
            const inactive = now - info.lastSeen.getTime();

            if (info.status === "online" && inactive > this.awayTimeout) {
                this.setPresence(userId, "away");
            } else if (info.status === "away" && inactive > this.offlineTimeout) {
                this.setPresence(userId, "offline");
            }
        }
    }

    removeUser(userId: string): void {
        if (this.presence.has(userId)) {
            this.presence.delete(userId);
            this.emit("presence_changed", { userId, status: "offline", previousStatus: "online" });
        }
    }

    getStats(): {
        online: number;
        away: number;
        busy: number;
        offline: number;
        total: number;
    } {
        const stats = { online: 0, away: 0, busy: 0, offline: 0, total: 0 };

        for (const info of this.presence.values()) {
            stats[info.status]++;
            stats.total++;
        }

        return stats;
    }
}

// ============================================================================
// TYPING INDICATOR (Improvements 158-160)
// ============================================================================

interface TypingInfo {
    userId: string;
    channelOrUserId: string;
    startedAt: Date;
    expiresAt: Date;
}

class TypingIndicator extends EventEmitter {
    private typing: Map<string, TypingInfo> = new Map();
    private readonly typingTimeout = 5000; // 5 seconds
    private cleanupInterval: NodeJS.Timeout | null = null;

    start(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 1000);
    }

    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    setTyping(userId: string, channelOrUserId: string): void {
        const key = `${userId}:${channelOrUserId}`;
        const isNew = !this.typing.has(key);

        this.typing.set(key, {
            userId,
            channelOrUserId,
            startedAt: this.typing.get(key)?.startedAt || new Date(),
            expiresAt: new Date(Date.now() + this.typingTimeout)
        });

        if (isNew) {
            this.emit("typing_started", { userId, channelOrUserId });
        }
    }

    stopTyping(userId: string, channelOrUserId: string): void {
        const key = `${userId}:${channelOrUserId}`;
        if (this.typing.delete(key)) {
            this.emit("typing_stopped", { userId, channelOrUserId });
        }
    }

    getTypingUsers(channelOrUserId: string): string[] {
        const users: string[] = [];

        for (const [key, info] of this.typing) {
            if (info.channelOrUserId === channelOrUserId) {
                users.push(info.userId);
            }
        }

        return users;
    }

    private cleanup(): void {
        const now = Date.now();

        for (const [key, info] of this.typing) {
            if (info.expiresAt.getTime() < now) {
                this.typing.delete(key);
                this.emit("typing_stopped", {
                    userId: info.userId,
                    channelOrUserId: info.channelOrUserId
                });
            }
        }
    }
}

// ============================================================================
// REALTIME COMMUNICATION SERVICE
// ============================================================================

export class RealtimeCommunicationService extends EventEmitter {
    public connections: ConnectionManager;
    public channels: ChannelManager;
    public broker: MessageBroker;
    public presence: PresenceManager;
    public typing: TypingIndicator;

    private presenceCheckInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.connections = new ConnectionManager();
        this.channels = new ChannelManager();
        this.broker = new MessageBroker(this.connections, this.channels);
        this.presence = new PresenceManager();
        this.typing = new TypingIndicator();

        this.wireEvents();
        console.log("[RealtimeCommunication] Service initialized");
    }

    private wireEvents(): void {
        // Auto-cleanup subscriptions on disconnect
        this.connections.on("connection_removed", ({ connectionId }) => {
            this.channels.unsubscribeAll(connectionId);
        });

        // Forward events
        this.broker.on("message_published", (data) => this.emit("message", data));
        this.presence.on("presence_changed", (data) => this.emit("presence", data));
    }

    start(): void {
        this.connections.startHeartbeat();
        this.typing.start();

        // Presence timeout check
        this.presenceCheckInterval = setInterval(() => {
            this.presence.checkTimeouts();
        }, 30000);

        console.log("[RealtimeCommunication] Started");
    }

    stop(): void {
        this.connections.stopHeartbeat();
        this.typing.stop();

        if (this.presenceCheckInterval) {
            clearInterval(this.presenceCheckInterval);
            this.presenceCheckInterval = null;
        }

        console.log("[RealtimeCommunication] Stopped");
    }

    // High-level convenience methods

    async handleConnection(socket: any, userId?: string): Promise<Connection> {
        const connection = this.connections.addConnection(socket, userId);

        if (userId) {
            this.presence.setPresence(userId, "online");
        }

        return connection;
    }

    async handleDisconnection(connectionId: string): Promise<void> {
        const connection = this.connections.getConnection(connectionId);

        if (connection?.userId) {
            const remaining = this.connections.getConnectionsByUser(connection.userId);
            if (remaining.length <= 1) { // This connection is the last one
                this.presence.setPresence(connection.userId, "offline");
            }
        }

        this.connections.removeConnection(connectionId);
    }

    async handleMessage(connectionId: string, rawMessage: string): Promise<void> {
        this.connections.updateActivity(connectionId);
        const connection = this.connections.getConnection(connectionId);

        if (!connection) return;

        try {
            const message = JSON.parse(rawMessage);

            switch (message.type) {
                case "subscribe":
                    this.channels.subscribe(message.channel, connectionId);
                    break;

                case "unsubscribe":
                    this.channels.unsubscribe(message.channel, connectionId);
                    break;

                case "publish":
                    await this.broker.publish(message.channel, message.type, message.payload, {
                        sender: connection.userId
                    });
                    break;

                case "typing":
                    if (connection.userId) {
                        this.typing.setTyping(connection.userId, message.channel);
                    }
                    break;

                case "stop_typing":
                    if (connection.userId) {
                        this.typing.stopTyping(connection.userId, message.channel);
                    }
                    break;

                case "presence":
                    if (connection.userId) {
                        this.presence.setPresence(connection.userId, message.status, message.customStatus);
                    }
                    break;

                case "pong":
                    // Heartbeat response
                    break;

                default:
                    this.emit("custom_message", { connectionId, message });
            }
        } catch (error) {
            console.error("[RealtimeCommunication] Failed to handle message:", error);
        }
    }

    getStats(): {
        connections: ReturnType<ConnectionManager["getStats"]>;
        channels: { count: number; totalSubscribers: number };
        presence: ReturnType<PresenceManager["getStats"]>;
        queue: ReturnType<MessageBroker["getQueueStats"]>;
    } {
        const channels = this.channels.getChannels();

        return {
            connections: this.connections.getStats(),
            channels: {
                count: channels.length,
                totalSubscribers: channels.reduce((sum, c) => sum + c.subscribers.size, 0)
            },
            presence: this.presence.getStats(),
            queue: this.broker.getQueueStats()
        };
    }
}

// Singleton instance
export const realtimeCommunication = new RealtimeCommunicationService();

export default realtimeCommunication;
