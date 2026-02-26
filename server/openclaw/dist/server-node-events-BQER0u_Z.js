import "./paths-B4BZAPZh.js";
import "./utils-DCtXtPui.js";
import "./thinking-EAliFiVK.js";
import { Bt as createOutboundSendDeps, C as loadSessionEntry, Mt as agentCommand, Rt as resolveOutboundTarget, T as resolveGatewaySessionStoreTarget, Tr as enqueueSystemEvent, ft as requestHeartbeatNow, w as pruneLegacyStoreKeys } from "./reply-D-ejYZny.js";
import { f as resolveSessionAgentId } from "./agent-scope-CetJgM-R.js";
import { f as defaultRuntime } from "./subsystem-DkqfG4LL.js";
import { c as normalizeMainKey } from "./session-key-C2FENQ1Z.js";
import "./exec-BvIdloyw.js";
import "./model-selection-BGu7OGe6.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-BxJiM21b.js";
import "./host-env-security-ljCLeQmh.js";
import "./message-channel-D8ATLuBC.js";
import "./send-BrArH7TL.js";
import { i as loadConfig } from "./config-Cix160T5.js";
import "./env-vars-CvvqezS9.js";
import "./manifest-registry-UIPJjw6g.js";
import "./dock-D5PDfAsH.js";
import "./runner-BWvU_k4C.js";
import "./image-BHMJslE2.js";
import "./models-config-BatVPulR.js";
import "./pi-model-discovery-Bakt-Qrp.js";
import "./pi-embedded-helpers-CBr7pp25.js";
import "./sandbox-C2dWVofh.js";
import "./tool-catalog-Df2IQWtF.js";
import "./chrome-CsmLRBaw.js";
import "./tailscale-Dm3fN1ZW.js";
import "./ip-D0zgNmBV.js";
import "./tailnet-CEudzG0i.js";
import "./ws-BTdBA7Dw.js";
import "./auth-ZSL4jmG7.js";
import "./server-context-Dmvcq24T.js";
import "./frontmatter-DR47FZL2.js";
import "./skills-zC8MIn-b.js";
import "./redact-BfiIp21N.js";
import "./errors-ClPOHMgX.js";
import "./fs-safe-DmYE85G9.js";
import "./trash-CFAwvdBs.js";
import "./ssrf-XOYV4WGH.js";
import "./image-ops-DLkGOG0C.js";
import "./store-q4Ob_mrK.js";
import "./ports-DJup96n1.js";
import "./server-middleware-CQ0JmE7W.js";
import { h as updateSessionStore } from "./sessions-B9yXoHO1.js";
import { r as normalizeChannelId } from "./plugins-D4Ns2yTE.js";
import "./accounts-DFYKAwz0.js";
import "./accounts-Bw3VhFrr.js";
import "./accounts-Bs5Igj-6.js";
import "./bindings-CfY5TcJm.js";
import "./logging-B-Pt-Wis.js";
import "./send-to1qzJJa.js";
import "./paths-DI5fQaUg.js";
import "./chat-envelope-CurikSJo.js";
import "./tool-images-Dw_AqSiB.js";
import "./tool-display-BNnsnxQh.js";
import "./fetch-guard-Dh7-G6dE.js";
import "./api-key-rotation-C-Ymilxh.js";
import "./local-roots-DfZXlYAW.js";
import "./query-expansion-BLv24Ra3.js";
import "./model-catalog-0q2XBRrT.js";
import "./tokens-ClHH1F0w.js";
import "./with-timeout-DEZ-HGUx.js";
import { t as deliverOutboundPayloads } from "./deliver-K3v4weUV.js";
import "./diagnostic-BixZKFP-.js";
import "./diagnostic-session-state-Dw-KXCxN.js";
import "./send-CihQKNMw.js";
import "./model-BJ_FlRZw.js";
import "./exec-approvals-allowlist-C0Op7MQw.js";
import "./exec-safe-bin-runtime-policy-oxr3WBPn.js";
import "./reply-prefix-CSzC653S.js";
import "./memory-cli-Cwd4VrBr.js";
import "./manager-SEIDyiNv.js";
import "./retry-CZ0l8o0f.js";
import "./target-errors-B8VFqjnH.js";
import "./chunk-DLZjHO7W.js";
import "./markdown-tables-teIjybF6.js";
import "./ir-BeqX2GW9.js";
import "./render-CC7dS9Xb.js";
import "./commands-DpNf2wmR.js";
import "./commands-registry-BAdaU3pl.js";
import "./client-DLeBHbKS.js";
import "./call-CkzT-T4d.js";
import "./pairing-token-CQhr9eIv.js";
import "./channel-activity-AdlU2JvS.js";
import "./fetch-D4W31Tu1.js";
import "./tables-CDtQBeAL.js";
import "./send-4T-nsTvj.js";
import "./pairing-store-UpJPgxa1.js";
import "./proxy-CLRUdShp.js";
import "./links-DLmGbegT.js";
import "./cli-utils-Ca0KE-dW.js";
import "./help-format-BiGlS7JG.js";
import "./progress-ICIHPEsE.js";
import "./resolve-route-L5y-jIZP.js";
import "./replies-D-DEd1dE.js";
import "./skill-commands-SajRuDuc.js";
import "./workspace-dirs-BmlBC0wD.js";
import "./channel-selection-B2sYOPKv.js";
import "./outbound-attachment-BDcbjS4s.js";
import "./delivery-queue-BpNLh26f.js";
import "./session-cost-usage-B6kNUrh3.js";
import "./send-DDixrYWr.js";
import "./onboard-helpers-WQ9I7CYo.js";
import "./prompt-style-y4tpYJ-5.js";
import "./pairing-labels-BjZjJjuL.js";
import "./exec-approvals-Dabk4W5H.js";
import "./nodes-screen-lyeHywsr.js";
import "./server-lifecycle-DQQu2exx.js";
import "./stagger-C9cy2z6C.js";
import "./pi-tools.policy-CLSPVIV0.js";
import { c as parseMessageWithAttachments, l as formatForLog, r as registerApnsToken, s as normalizeRpcAttachmentsToChatAttachments } from "./push-apns-BRGDsNym.js";
import { randomUUID } from "node:crypto";

//#region src/gateway/server-node-events.ts
const MAX_EXEC_EVENT_OUTPUT_CHARS = 180;
const VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS = 1500;
const MAX_RECENT_VOICE_TRANSCRIPTS = 200;
const recentVoiceTranscripts = /* @__PURE__ */ new Map();
function normalizeNonEmptyString(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
function normalizeFiniteInteger(value) {
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}
function resolveVoiceTranscriptFingerprint(obj, text) {
	const eventId = normalizeNonEmptyString(obj.eventId) ?? normalizeNonEmptyString(obj.providerEventId) ?? normalizeNonEmptyString(obj.transcriptId);
	if (eventId) return `event:${eventId}`;
	const callId = normalizeNonEmptyString(obj.providerCallId) ?? normalizeNonEmptyString(obj.callId);
	const sequence = normalizeFiniteInteger(obj.sequence) ?? normalizeFiniteInteger(obj.seq);
	if (callId && sequence !== null) return `call-seq:${callId}:${sequence}`;
	const eventTimestamp = normalizeFiniteInteger(obj.timestamp) ?? normalizeFiniteInteger(obj.ts) ?? normalizeFiniteInteger(obj.eventTimestamp);
	if (callId && eventTimestamp !== null) return `call-ts:${callId}:${eventTimestamp}`;
	if (eventTimestamp !== null) return `timestamp:${eventTimestamp}|text:${text}`;
	return `text:${text}`;
}
function shouldDropDuplicateVoiceTranscript(params) {
	const previous = recentVoiceTranscripts.get(params.sessionKey);
	if (previous && previous.fingerprint === params.fingerprint && params.now - previous.ts <= VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS) return true;
	recentVoiceTranscripts.set(params.sessionKey, {
		fingerprint: params.fingerprint,
		ts: params.now
	});
	if (recentVoiceTranscripts.size > MAX_RECENT_VOICE_TRANSCRIPTS) {
		const cutoff = params.now - VOICE_TRANSCRIPT_DEDUPE_WINDOW_MS * 2;
		for (const [key, value] of recentVoiceTranscripts) {
			if (value.ts < cutoff) recentVoiceTranscripts.delete(key);
			if (recentVoiceTranscripts.size <= MAX_RECENT_VOICE_TRANSCRIPTS) break;
		}
		while (recentVoiceTranscripts.size > MAX_RECENT_VOICE_TRANSCRIPTS) {
			const oldestKey = recentVoiceTranscripts.keys().next().value;
			if (oldestKey === void 0) break;
			recentVoiceTranscripts.delete(oldestKey);
		}
	}
	return false;
}
function compactExecEventOutput(raw) {
	const normalized = raw.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.length <= MAX_EXEC_EVENT_OUTPUT_CHARS) return normalized;
	const safe = Math.max(1, MAX_EXEC_EVENT_OUTPUT_CHARS - 1);
	return `${normalized.slice(0, safe)}…`;
}
async function touchSessionStore(params) {
	const { storePath } = params;
	if (!storePath) return;
	await updateSessionStore(storePath, (store) => {
		const target = resolveGatewaySessionStoreTarget({
			cfg: params.cfg,
			key: params.sessionKey,
			store
		});
		pruneLegacyStoreKeys({
			store,
			canonicalKey: target.canonicalKey,
			candidates: target.storeKeys
		});
		store[params.canonicalKey] = {
			sessionId: params.sessionId,
			updatedAt: params.now,
			thinkingLevel: params.entry?.thinkingLevel,
			verboseLevel: params.entry?.verboseLevel,
			reasoningLevel: params.entry?.reasoningLevel,
			systemSent: params.entry?.systemSent,
			sendPolicy: params.entry?.sendPolicy,
			lastChannel: params.entry?.lastChannel,
			lastTo: params.entry?.lastTo
		};
	});
}
function queueSessionStoreTouch(params) {
	touchSessionStore({
		cfg: params.cfg,
		sessionKey: params.sessionKey,
		storePath: params.storePath,
		canonicalKey: params.canonicalKey,
		entry: params.entry,
		sessionId: params.sessionId,
		now: params.now
	}).catch((err) => {
		params.ctx.logGateway.warn("voice session-store update failed: " + formatForLog(err));
	});
}
function parseSessionKeyFromPayloadJSON(payloadJSON) {
	let payload;
	try {
		payload = JSON.parse(payloadJSON);
	} catch {
		return null;
	}
	if (typeof payload !== "object" || payload === null) return null;
	const obj = payload;
	const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
	return sessionKey.length > 0 ? sessionKey : null;
}
function parsePayloadObject(payloadJSON) {
	if (!payloadJSON) return null;
	let payload;
	try {
		payload = JSON.parse(payloadJSON);
	} catch {
		return null;
	}
	return typeof payload === "object" && payload !== null ? payload : null;
}
async function sendReceiptAck(params) {
	const resolved = resolveOutboundTarget({
		channel: params.channel,
		to: params.to,
		cfg: params.cfg,
		mode: "explicit"
	});
	if (!resolved.ok) throw new Error(String(resolved.error));
	const agentId = resolveSessionAgentId({
		sessionKey: params.sessionKey,
		config: params.cfg
	});
	await deliverOutboundPayloads({
		cfg: params.cfg,
		channel: params.channel,
		to: resolved.to,
		payloads: [{ text: params.text }],
		agentId,
		bestEffort: true,
		deps: createOutboundSendDeps(params.deps)
	});
}
const handleNodeEvent = async (ctx, nodeId, evt) => {
	switch (evt.event) {
		case "voice.transcript": {
			const obj = parsePayloadObject(evt.payloadJSON);
			if (!obj) return;
			const text = typeof obj.text === "string" ? obj.text.trim() : "";
			if (!text) return;
			if (text.length > 2e4) return;
			const sessionKeyRaw = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : "";
			const cfg = loadConfig();
			const rawMainKey = normalizeMainKey(cfg.session?.mainKey);
			const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : rawMainKey;
			const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
			const now = Date.now();
			if (shouldDropDuplicateVoiceTranscript({
				sessionKey: canonicalKey,
				fingerprint: resolveVoiceTranscriptFingerprint(obj, text),
				now
			})) return;
			const sessionId = entry?.sessionId ?? randomUUID();
			queueSessionStoreTouch({
				ctx,
				cfg,
				sessionKey,
				storePath,
				canonicalKey,
				entry,
				sessionId,
				now
			});
			ctx.addChatRun(sessionId, {
				sessionKey: canonicalKey,
				clientRunId: `voice-${randomUUID()}`
			});
			agentCommand({
				message: text,
				sessionId,
				sessionKey: canonicalKey,
				thinking: "low",
				deliver: false,
				messageChannel: "node",
				inputProvenance: {
					kind: "external_user",
					sourceChannel: "voice",
					sourceTool: "gateway.voice.transcript"
				}
			}, defaultRuntime, ctx.deps).catch((err) => {
				ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
			});
			return;
		}
		case "agent.request": {
			if (!evt.payloadJSON) return;
			let link = null;
			try {
				link = JSON.parse(evt.payloadJSON);
			} catch {
				return;
			}
			let message = (link?.message ?? "").trim();
			const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(link?.attachments ?? void 0);
			let images = [];
			if (normalizedAttachments.length > 0) try {
				const parsed = await parseMessageWithAttachments(message, normalizedAttachments, {
					maxBytes: 5e6,
					log: ctx.logGateway
				});
				message = parsed.message.trim();
				images = parsed.images;
			} catch {
				return;
			}
			if (!message) return;
			if (message.length > 2e4) return;
			let channel = normalizeChannelId(typeof link?.channel === "string" ? link.channel.trim() : "") ?? void 0;
			let to = typeof link?.to === "string" && link.to.trim() ? link.to.trim() : void 0;
			const deliverRequested = Boolean(link?.deliver);
			const wantsReceipt = Boolean(link?.receipt);
			const receiptText = (typeof link?.receiptText === "string" ? link.receiptText.trim() : "") || "Just received your iOS share + request, working on it.";
			const sessionKeyRaw = (link?.sessionKey ?? "").trim();
			const sessionKey = sessionKeyRaw.length > 0 ? sessionKeyRaw : `node-${nodeId}`;
			const cfg = loadConfig();
			const { storePath, entry, canonicalKey } = loadSessionEntry(sessionKey);
			const now = Date.now();
			const sessionId = entry?.sessionId ?? randomUUID();
			await touchSessionStore({
				cfg,
				sessionKey,
				storePath,
				canonicalKey,
				entry,
				sessionId,
				now
			});
			if (deliverRequested && (!channel || !to)) {
				const entryChannel = typeof entry?.lastChannel === "string" ? normalizeChannelId(entry.lastChannel) : void 0;
				const entryTo = typeof entry?.lastTo === "string" ? entry.lastTo.trim() : "";
				if (!channel && entryChannel) channel = entryChannel;
				if (!to && entryTo) to = entryTo;
			}
			const deliver = deliverRequested && Boolean(channel && to);
			const deliveryChannel = deliver ? channel : void 0;
			const deliveryTo = deliver ? to : void 0;
			if (deliverRequested && !deliver) ctx.logGateway.warn(`agent delivery disabled node=${nodeId}: missing session delivery route (channel=${channel ?? "-"} to=${to ?? "-"})`);
			if (wantsReceipt && deliveryChannel && deliveryTo) sendReceiptAck({
				cfg,
				deps: ctx.deps,
				sessionKey: canonicalKey,
				channel: deliveryChannel,
				to: deliveryTo,
				text: receiptText
			}).catch((err) => {
				ctx.logGateway.warn(`agent receipt failed node=${nodeId}: ${formatForLog(err)}`);
			});
			else if (wantsReceipt) ctx.logGateway.warn(`agent receipt skipped node=${nodeId}: missing delivery route (channel=${deliveryChannel ?? "-"} to=${deliveryTo ?? "-"})`);
			agentCommand({
				message,
				images,
				sessionId,
				sessionKey: canonicalKey,
				thinking: link?.thinking ?? void 0,
				deliver,
				to: deliveryTo,
				channel: deliveryChannel,
				timeout: typeof link?.timeoutSeconds === "number" ? link.timeoutSeconds.toString() : void 0,
				messageChannel: "node"
			}, defaultRuntime, ctx.deps).catch((err) => {
				ctx.logGateway.warn(`agent failed node=${nodeId}: ${formatForLog(err)}`);
			});
			return;
		}
		case "chat.subscribe": {
			if (!evt.payloadJSON) return;
			const sessionKey = parseSessionKeyFromPayloadJSON(evt.payloadJSON);
			if (!sessionKey) return;
			ctx.nodeSubscribe(nodeId, sessionKey);
			return;
		}
		case "chat.unsubscribe": {
			if (!evt.payloadJSON) return;
			const sessionKey = parseSessionKeyFromPayloadJSON(evt.payloadJSON);
			if (!sessionKey) return;
			ctx.nodeUnsubscribe(nodeId, sessionKey);
			return;
		}
		case "exec.started":
		case "exec.finished":
		case "exec.denied": {
			const obj = parsePayloadObject(evt.payloadJSON);
			if (!obj) return;
			const sessionKey = typeof obj.sessionKey === "string" ? obj.sessionKey.trim() : `node-${nodeId}`;
			if (!sessionKey) return;
			if (!(loadConfig().tools?.exec?.notifyOnExit !== false)) return;
			const runId = typeof obj.runId === "string" ? obj.runId.trim() : "";
			const command = typeof obj.command === "string" ? obj.command.trim() : "";
			const exitCode = typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode) ? obj.exitCode : void 0;
			const timedOut = obj.timedOut === true;
			const output = typeof obj.output === "string" ? obj.output.trim() : "";
			const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
			let text = "";
			if (evt.event === "exec.started") {
				text = `Exec started (node=${nodeId}${runId ? ` id=${runId}` : ""})`;
				if (command) text += `: ${command}`;
			} else if (evt.event === "exec.finished") {
				const exitLabel = timedOut ? "timeout" : `code ${exitCode ?? "?"}`;
				const compactOutput = compactExecEventOutput(output);
				if (!(timedOut || exitCode !== 0 || compactOutput.length > 0)) return;
				text = `Exec finished (node=${nodeId}${runId ? ` id=${runId}` : ""}, ${exitLabel})`;
				if (compactOutput) text += `\n${compactOutput}`;
			} else {
				text = `Exec denied (node=${nodeId}${runId ? ` id=${runId}` : ""}${reason ? `, ${reason}` : ""})`;
				if (command) text += `: ${command}`;
			}
			enqueueSystemEvent(text, {
				sessionKey,
				contextKey: runId ? `exec:${runId}` : "exec"
			});
			requestHeartbeatNow({ reason: "exec-event" });
			return;
		}
		case "push.apns.register": {
			const obj = parsePayloadObject(evt.payloadJSON);
			if (!obj) return;
			const token = typeof obj.token === "string" ? obj.token : "";
			const topic = typeof obj.topic === "string" ? obj.topic : "";
			const environment = obj.environment;
			try {
				await registerApnsToken({
					nodeId,
					token,
					topic,
					environment
				});
			} catch (err) {
				ctx.logGateway.warn(`push apns register failed node=${nodeId}: ${formatForLog(err)}`);
			}
			return;
		}
		default: return;
	}
};

//#endregion
export { handleNodeEvent };