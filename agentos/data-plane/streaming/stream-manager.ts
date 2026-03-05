import { EventEmitter } from "events";
import { StreamConfig, StreamMessage, StreamSubscription } from "../types";

interface InternalSub {
  subject: string;
  handler: (msg: StreamMessage) => Promise<void>;
  config: StreamConfig;
  inFlight: number;
  paused: boolean;
}

export class StreamManager extends EventEmitter {
  private streams = new Map<string, StreamConfig>();
  private subscribers = new Map<string, Set<InternalSub>>();
  private messages = new Map<string, StreamMessage[]>();
  private deduplicationCache = new Map<string, Set<string>>();
  private idCounter = 0;

  /** Create or update a stream configuration. */
  createStream(config: StreamConfig): void {
    this.streams.set(config.name, config);
    if (!this.messages.has(config.name)) {
      this.messages.set(config.name, []);
    }
    this.emit("stream:created", config);
  }

  deleteStream(name: string): boolean {
    this.subscribers.delete(name);
    this.messages.delete(name);
    this.deduplicationCache.delete(name);
    return this.streams.delete(name);
  }

  /** Publish a message to a stream subject. */
  async publish<T = unknown>(
    streamName: string,
    subject: string,
    data: T,
    headers: Record<string, string> = {}
  ): Promise<string> {
    const config = this.streams.get(streamName);
    if (!config) throw new Error(`Stream not found: ${streamName}`);

    const msgId = this.nextId();

    // Deduplication check
    if (config.deduplicationWindowMs) {
      const dedupKey = `${subject}:${JSON.stringify(data)}`;
      if (!this.deduplicationCache.has(streamName)) {
        this.deduplicationCache.set(streamName, new Set());
      }
      const cache = this.deduplicationCache.get(streamName)!;
      if (cache.has(dedupKey)) {
        this.emit("stream:deduplicated", { streamName, subject });
        return msgId;
      }
      cache.add(dedupKey);
      setTimeout(() => cache.delete(dedupKey), config.deduplicationWindowMs);
    }

    const msg = this.buildMessage(msgId, subject, data, headers, config);

    // Store message
    const store = this.messages.get(streamName)!;
    store.push(msg);

    // Enforce maxBytes (approximate by counting stored messages)
    if (config.maxBytes && store.length > config.maxBytes) {
      store.shift();
    }

    // Dispatch to matching subscribers with backpressure
    await this.dispatch(streamName, subject, msg);
    this.emit("stream:published", { streamName, subject, msgId });

    return msgId;
  }

  /** Subscribe to a stream subject pattern. Supports wildcards: `>` and `*`. */
  subscribe(
    streamName: string,
    subject: string,
    handler: (msg: StreamMessage) => Promise<void>,
    configOverrides?: Partial<StreamConfig>
  ): StreamSubscription {
    const baseConfig = this.streams.get(streamName);
    if (!baseConfig) throw new Error(`Stream not found: ${streamName}`);

    const config: StreamConfig = { ...baseConfig, ...configOverrides };
    const sub: InternalSub = { subject, handler, config, inFlight: 0, paused: false };

    if (!this.subscribers.has(streamName)) {
      this.subscribers.set(streamName, new Set());
    }
    this.subscribers.get(streamName)!.add(sub);

    return {
      unsubscribe: () => {
        this.subscribers.get(streamName)?.delete(sub);
      },
    };
  }

  /** Replay stored messages for a stream. */
  async replay(
    streamName: string,
    handler: (msg: StreamMessage) => Promise<void>,
    fromIndex = 0
  ): Promise<number> {
    const store = this.messages.get(streamName);
    if (!store) return 0;

    let count = 0;
    for (let i = fromIndex; i < store.length; i++) {
      await handler(store[i]);
      count++;
    }
    return count;
  }

  getStreamInfo(name: string): { config: StreamConfig; messageCount: number; subscriberCount: number } | null {
    const config = this.streams.get(name);
    if (!config) return null;
    return {
      config,
      messageCount: this.messages.get(name)?.length ?? 0,
      subscriberCount: this.subscribers.get(name)?.size ?? 0,
    };
  }

  get streamNames(): string[] {
    return Array.from(this.streams.keys());
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async dispatch(streamName: string, subject: string, msg: StreamMessage): Promise<void> {
    const subs = this.subscribers.get(streamName);
    if (!subs) return;

    const matching = Array.from(subs).filter((s) => this.matchSubject(s.subject, subject));

    for (const sub of matching) {
      // Backpressure: skip if at max in-flight
      if (sub.inFlight >= sub.config.maxInFlight) {
        sub.paused = true;
        this.emit("stream:backpressure", { streamName, subject });
        continue;
      }

      sub.inFlight++;
      const wrappedMsg = this.wrapWithAck(msg, sub);

      // Fire-and-forget with ack timeout
      this.deliverWithTimeout(sub, wrappedMsg).catch((err) =>
        this.emit("stream:error", { streamName, subject, error: err })
      );
    }
  }

  private async deliverWithTimeout(sub: InternalSub, msg: StreamMessage): Promise<void> {
    let retries = 0;
    while (retries <= sub.config.maxRetries) {
      try {
        await Promise.race([
          sub.handler(msg),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Ack timeout")), sub.config.ackWaitMs)
          ),
        ]);
        return;
      } catch {
        retries++;
      }
    }
    this.emit("stream:deadLetter", { subject: msg.subject, msgId: msg.id });
  }

  private wrapWithAck(msg: StreamMessage, sub: InternalSub): StreamMessage {
    return {
      ...msg,
      ack: () => {
        sub.inFlight = Math.max(0, sub.inFlight - 1);
        if (sub.paused && sub.inFlight < sub.config.maxInFlight) {
          sub.paused = false;
        }
      },
      nack: () => {
        sub.inFlight = Math.max(0, sub.inFlight - 1);
      },
    };
  }

  private matchSubject(pattern: string, subject: string): boolean {
    if (pattern === ">") return true;
    const pParts = pattern.split(".");
    const sParts = subject.split(".");
    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i] === ">") return true;
      if (pParts[i] === "*") continue;
      if (pParts[i] !== sParts[i]) return false;
    }
    return pParts.length === sParts.length;
  }

  private buildMessage<T>(
    id: string,
    subject: string,
    data: T,
    headers: Record<string, string>,
    _config: StreamConfig
  ): StreamMessage<T> {
    return {
      id,
      subject,
      data,
      timestamp: new Date(),
      headers,
      ack: () => {},
      nack: () => {},
    };
  }

  private nextId(): string {
    return `msg-${Date.now()}-${++this.idCounter}`;
  }
}
