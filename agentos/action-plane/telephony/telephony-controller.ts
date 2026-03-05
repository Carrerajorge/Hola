/**
 * AgentOS Action-Plane — Telephony Controller
 *
 * Voice / telephony controller for PSTN/SIP calls.
 * Manages STT/TTS, scripted conversations, confirmations, logging.
 * Requires explicit user consent before any outbound call.
 */

import {
  ActionResult,
  AuditEntry,
  CallDirection,
  CallStatus,
  ConsentRecord,
  TelephonyCall,
  TranscriptSegment,
} from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[TELEPHONY][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[TELEPHONY][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[TELEPHONY][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export interface TelephonyProvider {
  /** Initiate an outbound call and return a provider-specific call handle. */
  dial(from: string, to: string): Promise<string>;
  /** Hang up an active call by handle. */
  hangup(handle: string): Promise<void>;
  /** Send synthesised speech to the call. */
  speak(handle: string, text: string): Promise<void>;
  /** Start streaming STT results. Returns an async iterator of segments. */
  listenStream(handle: string): AsyncIterable<TranscriptSegment>;
  /** Get current call status. */
  status(handle: string): Promise<CallStatus>;
}

export interface TTSEngine {
  synthesise(text: string, voice?: string): Promise<Uint8Array>;
}

export interface STTEngine {
  transcribe(audio: Uint8Array): Promise<TranscriptSegment[]>;
}

// ---------------------------------------------------------------------------
// Conversation script
// ---------------------------------------------------------------------------

export interface ScriptStep {
  /** Text to speak to the other party. */
  say: string;
  /** Wait for the other party to respond for up to this many seconds. */
  listenSec: number;
  /** Optional: expected keywords to confirm. If present, retry if not heard. */
  confirmKeywords?: string[];
  /** Maximum confirmation retries. */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TelephonyControllerConfig {
  provider: TelephonyProvider;
  tts?: TTSEngine;
  stt?: STTEngine;
  /** Default caller ID. */
  defaultFrom: string;
  /** Maximum call duration in seconds (safety cap). */
  maxCallDurationSec: number;
}

// ---------------------------------------------------------------------------
// Consent Manager (embedded)
// ---------------------------------------------------------------------------

class ConsentManager {
  private records = new Map<string, ConsentRecord>();

  grant(description: string, grantedBy: string, scopes: string[], ttlMs?: number): ConsentRecord {
    const record: ConsentRecord = {
      id: `consent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      actionDescription: description,
      grantedBy,
      grantedAt: new Date(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : undefined,
      scopes,
      revoked: false,
    };
    this.records.set(record.id, record);
    log.info("Consent granted", { id: record.id, scopes });
    return record;
  }

  validate(consentId: string, requiredScope: string): boolean {
    const record = this.records.get(consentId);
    if (!record) return false;
    if (record.revoked) return false;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return false;
    return record.scopes.includes(requiredScope);
  }

  revoke(consentId: string): void {
    const record = this.records.get(consentId);
    if (record) {
      record.revoked = true;
      log.info("Consent revoked", { id: consentId });
    }
  }
}

// ---------------------------------------------------------------------------
// Telephony Controller
// ---------------------------------------------------------------------------

export class TelephonyController {
  private cfg: TelephonyControllerConfig;
  private consent = new ConsentManager();
  private activeCalls = new Map<string, { call: TelephonyCall; providerHandle: string }>();

  constructor(config: TelephonyControllerConfig) {
    this.cfg = config;
    log.info("TelephonyController initialised", {
      from: config.defaultFrom,
      maxDuration: config.maxCallDurationSec,
    });
  }

  // ---- Consent -----------------------------------------------------------

  grantConsent(description: string, grantedBy: string, ttlMs?: number): ConsentRecord {
    return this.consent.grant(description, grantedBy, ["telephony", "outbound-call"], ttlMs);
  }

  revokeConsent(consentId: string): void {
    this.consent.revoke(consentId);
  }

  // ---- Outbound call -----------------------------------------------------

  async placeCall(
    to: string,
    consentId: string,
    script: ScriptStep[],
    from?: string,
  ): Promise<ActionResult<TelephonyCall>> {
    const start = Date.now();
    const audit: AuditEntry[] = [];
    const caller = from ?? this.cfg.defaultFrom;

    // --- Consent check (mandatory) ---
    if (!this.consent.validate(consentId, "outbound-call")) {
      log.error("Consent not valid for outbound call", { consentId });
      return this.fail("call-denied", "Valid consent required for outbound calls", start, audit);
    }

    audit.push(this.auditInfo(`Consent verified: ${consentId}`));

    // --- Dial ---
    let providerHandle: string;
    try {
      providerHandle = await this.cfg.provider.dial(caller, to);
    } catch (err) {
      return this.fail("call-dial", `Dial failed: ${String(err)}`, start, audit);
    }

    const call: TelephonyCall = {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      direction: "outbound",
      from: caller,
      to,
      status: "ringing",
      provider: "configured-provider",
      startedAt: new Date(),
      transcript: [],
      consentId,
    };

    this.activeCalls.set(call.id, { call, providerHandle });
    audit.push(this.auditInfo(`Call initiated: ${call.id}`));

    // --- Safety timeout ---
    const safetyTimer = setTimeout(() => {
      void this.hangup(call.id);
      log.warn("Call terminated by safety timeout", { callId: call.id });
    }, this.cfg.maxCallDurationSec * 1000);

    // --- Execute script ---
    try {
      call.status = "in_progress";
      await this.executeScript(call, providerHandle, script, audit);
      call.status = "completed";
    } catch (err) {
      call.status = "failed";
      audit.push({ timestamp: new Date(), level: "error", message: String(err) });
      log.error("Script execution failed", { callId: call.id, error: String(err) });
    } finally {
      clearTimeout(safetyTimer);
      call.endedAt = new Date();
      await this.safeHangup(providerHandle);
      this.activeCalls.delete(call.id);
    }

    return {
      actionId: call.id,
      status: call.status === "completed" ? "success" : "failure",
      data: call,
      durationMs: Date.now() - start,
      auditLog: audit,
      timestamp: new Date(),
    };
  }

  // ---- Hangup ------------------------------------------------------------

  async hangup(callId: string): Promise<void> {
    const entry = this.activeCalls.get(callId);
    if (!entry) return;
    await this.safeHangup(entry.providerHandle);
    entry.call.status = "cancelled";
    entry.call.endedAt = new Date();
    this.activeCalls.delete(callId);
    log.info("Call hung up", { callId });
  }

  // ---- Script execution --------------------------------------------------

  private async executeScript(
    call: TelephonyCall,
    handle: string,
    steps: ScriptStep[],
    audit: AuditEntry[],
  ): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      audit.push(this.auditInfo(`Step ${i + 1}: speaking`));

      await this.cfg.provider.speak(handle, step.say);
      call.transcript.push({
        speaker: "agent",
        text: step.say,
        startSec: (Date.now() - call.startedAt!.getTime()) / 1000,
        endSec: 0,
        confidence: 1,
      });

      // Listen for response
      const segments = await this.listenForDuration(handle, step.listenSec);
      call.transcript.push(...segments);

      // Confirmation check
      if (step.confirmKeywords && step.confirmKeywords.length > 0) {
        const heard = segments.map((s) => s.text.toLowerCase()).join(" ");
        let confirmed = step.confirmKeywords.some((kw) => heard.includes(kw.toLowerCase()));
        let retries = 0;
        const maxRetries = step.maxRetries ?? 2;

        while (!confirmed && retries < maxRetries) {
          retries++;
          audit.push(this.auditInfo(`Confirmation retry ${retries} for step ${i + 1}`));
          await this.cfg.provider.speak(handle, "I didn't catch that. Could you please confirm?");
          const retrySeg = await this.listenForDuration(handle, step.listenSec);
          call.transcript.push(...retrySeg);
          const retryHeard = retrySeg.map((s) => s.text.toLowerCase()).join(" ");
          confirmed = step.confirmKeywords.some((kw) => retryHeard.includes(kw.toLowerCase()));
        }

        if (!confirmed) {
          audit.push({ timestamp: new Date(), level: "warn", message: `Confirmation failed for step ${i + 1}` });
        }
      }
    }
  }

  // ---- Helpers -----------------------------------------------------------

  private async listenForDuration(handle: string, sec: number): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = [];
    const deadline = Date.now() + sec * 1000;

    try {
      for await (const seg of this.cfg.provider.listenStream(handle)) {
        segments.push(seg);
        if (Date.now() >= deadline) break;
      }
    } catch (err) {
      log.warn("Listen stream interrupted", { error: String(err) });
    }

    return segments;
  }

  private async safeHangup(handle: string): Promise<void> {
    try {
      await this.cfg.provider.hangup(handle);
    } catch (err) {
      log.warn("Hangup failed (may already be disconnected)", { error: String(err) });
    }
  }

  private fail(actionId: string, error: string, start: number, audit: AuditEntry[]): ActionResult<TelephonyCall> {
    audit.push({ timestamp: new Date(), level: "error", message: error });
    return {
      actionId,
      status: "failure",
      error,
      durationMs: Date.now() - start,
      auditLog: audit,
      timestamp: new Date(),
    };
  }

  private auditInfo(message: string): AuditEntry {
    return { timestamp: new Date(), level: "info", message };
  }
}
