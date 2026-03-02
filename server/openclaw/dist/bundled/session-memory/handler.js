import { c as resolveAgentWorkspaceDir } from "../../agent-scope-BbLbkVXD.js";
import { s as resolveStateDir } from "../../paths-C9do7WCN.js";
import { t as createSubsystemLogger } from "../../subsystem-BoKOAh1n.js";
import { l as resolveAgentIdFromSessionKey } from "../../session-key-YGVrIVO5.js";
import "../../workspace-PSi34tZF.js";
import "../../model-selection-B5NjONwE.js";
import "../../github-copilot-token-BkwQAVvU.js";
import "../../env-Bw45uydv.js";
import "../../boolean-mcn6kL0s.js";
import "../../tokens-BLlPaiD5.js";
import "../../pi-embedded-CV53eKpr.js";
import "../../plugins-BlRpkhyC.js";
import "../../accounts-CxYlEftx.js";
import "../../bindings-BCOutV7A.js";
import "../../send-BF8QfC--.js";
import "../../send-CBl-cFHi.js";
import "../../deliver-BHbS7MPi.js";
import "../../diagnostic-D_de7-KX.js";
import "../../diagnostic-session-state-C0Sxjfox.js";
import "../../accounts-Ci-FogVD.js";
import "../../send-BEnRshK8.js";
import "../../image-ops-DR7iVy0X.js";
import "../../pi-model-discovery-C-yOXpma.js";
import "../../message-channel-NXidGUO7.js";
import "../../pi-embedded-helpers-ABBMCQ4Q.js";
import "../../config-DvUlTmaK.js";
import "../../manifest-registry-DARtGCWp.js";
import "../../dock-Devv97xs.js";
import "../../chrome-j8n4RCAx.js";
import "../../ssrf-BM54dmk8.js";
import "../../frontmatter-CYyVkHva.js";
import "../../skills-DOKat65v.js";
import "../../redact-C_vdZ7-E.js";
import "../../errors-BggFlOL1.js";
import "../../store-DoCZrlTi.js";
import { O as hasInterSessionUserProvenance } from "../../sessions-BiWBZ-uj.js";
import "../../accounts-DKYigdEx.js";
import "../../paths-CLWDvYDE.js";
import "../../tool-images-DeM5viPH.js";
import "../../thinking-CJoHneR6.js";
import "../../image-C3Y2REz9.js";
import "../../reply-prefix-Cha4QN8H.js";
import "../../manager-DkvrfiWy.js";
import "../../gemini-auth-DejNVJue.js";
import "../../fetch-guard-Diq4wbzK.js";
import "../../query-expansion-CqHuxZ09.js";
import "../../retry-CpSN4cGC.js";
import "../../target-errors-C4v9HKnW.js";
import "../../chunk-BK8T_RCs.js";
import "../../markdown-tables-B8I8M-Et.js";
import "../../local-roots-DS-8ZE_B.js";
import "../../ir-DQn3JpQE.js";
import "../../render-loap2gRq.js";
import "../../commands-registry-CclRtEXd.js";
import "../../skill-commands-6qLPyery.js";
import "../../runner-RETaennS.js";
import "../../fetch-CSgvhNYZ.js";
import "../../channel-activity-mEN8_E9p.js";
import "../../tables-DV7HmexJ.js";
import "../../send-CVwZarG_.js";
import "../../outbound-attachment-Bki_6KDV.js";
import "../../send-C01_1hGB.js";
import "../../resolve-route-BUlSpAUe.js";
import "../../proxy-Bee2aKQk.js";
import "../../replies-D3ifXz7i.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
import { t as resolveHookConfig } from "../../config-BeIwBEE4.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

//#region src/hooks/bundled/session-memory/handler.ts
/**
* Session memory hook handler
*
* Saves session context to memory when /new or /reset command is triggered
* Creates a new dated memory file with LLM-generated slug
*/
const log = createSubsystemLogger("hooks/session-memory");
/**
* Read recent messages from session file for slug generation
*/
async function getRecentSessionContent(sessionFilePath, messageCount = 15) {
	try {
		const lines = (await fs.readFile(sessionFilePath, "utf-8")).trim().split("\n");
		const allMessages = [];
		for (const line of lines) try {
			const entry = JSON.parse(line);
			if (entry.type === "message" && entry.message) {
				const msg = entry.message;
				const role = msg.role;
				if ((role === "user" || role === "assistant") && msg.content) {
					if (role === "user" && hasInterSessionUserProvenance(msg)) continue;
					const text = Array.isArray(msg.content) ? msg.content.find((c) => c.type === "text")?.text : msg.content;
					if (text && !text.startsWith("/")) allMessages.push(`${role}: ${text}`);
				}
			}
		} catch {}
		return allMessages.slice(-messageCount).join("\n");
	} catch {
		return null;
	}
}
/**
* Try the active transcript first; if /new already rotated it,
* fallback to the latest .jsonl.reset.* sibling.
*/
async function getRecentSessionContentWithResetFallback(sessionFilePath, messageCount = 15) {
	const primary = await getRecentSessionContent(sessionFilePath, messageCount);
	if (primary) return primary;
	try {
		const dir = path.dirname(sessionFilePath);
		const resetPrefix = `${path.basename(sessionFilePath)}.reset.`;
		const resetCandidates = (await fs.readdir(dir)).filter((name) => name.startsWith(resetPrefix)).toSorted();
		if (resetCandidates.length === 0) return primary;
		const latestResetPath = path.join(dir, resetCandidates[resetCandidates.length - 1]);
		const fallback = await getRecentSessionContent(latestResetPath, messageCount);
		if (fallback) log.debug("Loaded session content from reset fallback", {
			sessionFilePath,
			latestResetPath
		});
		return fallback || primary;
	} catch {
		return primary;
	}
}
function stripResetSuffix(fileName) {
	const resetIndex = fileName.indexOf(".reset.");
	return resetIndex === -1 ? fileName : fileName.slice(0, resetIndex);
}
async function findPreviousSessionFile(params) {
	try {
		const files = await fs.readdir(params.sessionsDir);
		const fileSet = new Set(files);
		const baseFromReset = params.currentSessionFile ? stripResetSuffix(path.basename(params.currentSessionFile)) : void 0;
		if (baseFromReset && fileSet.has(baseFromReset)) return path.join(params.sessionsDir, baseFromReset);
		const trimmedSessionId = params.sessionId?.trim();
		if (trimmedSessionId) {
			const canonicalFile = `${trimmedSessionId}.jsonl`;
			if (fileSet.has(canonicalFile)) return path.join(params.sessionsDir, canonicalFile);
			const topicVariants = files.filter((name) => name.startsWith(`${trimmedSessionId}-topic-`) && name.endsWith(".jsonl") && !name.includes(".reset.")).toSorted().toReversed();
			if (topicVariants.length > 0) return path.join(params.sessionsDir, topicVariants[0]);
		}
		if (!params.currentSessionFile) return;
		const nonResetJsonl = files.filter((name) => name.endsWith(".jsonl") && !name.includes(".reset.")).toSorted().toReversed();
		if (nonResetJsonl.length > 0) return path.join(params.sessionsDir, nonResetJsonl[0]);
	} catch {}
}
/**
* Save session context to memory when /new or /reset command is triggered
*/
const saveSessionToMemory = async (event) => {
	const isResetCommand = event.action === "new" || event.action === "reset";
	if (event.type !== "command" || !isResetCommand) return;
	try {
		log.debug("Hook triggered for reset/new command", { action: event.action });
		const context = event.context || {};
		const cfg = context.cfg;
		const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
		const workspaceDir = cfg ? resolveAgentWorkspaceDir(cfg, agentId) : path.join(resolveStateDir(process.env, os.homedir), "workspace");
		const memoryDir = path.join(workspaceDir, "memory");
		await fs.mkdir(memoryDir, { recursive: true });
		const now = new Date(event.timestamp);
		const dateStr = now.toISOString().split("T")[0];
		const sessionEntry = context.previousSessionEntry || context.sessionEntry || {};
		const currentSessionId = sessionEntry.sessionId;
		let currentSessionFile = sessionEntry.sessionFile || void 0;
		if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
			const sessionsDirs = /* @__PURE__ */ new Set();
			if (currentSessionFile) sessionsDirs.add(path.dirname(currentSessionFile));
			sessionsDirs.add(path.join(workspaceDir, "sessions"));
			for (const sessionsDir of sessionsDirs) {
				const recoveredSessionFile = await findPreviousSessionFile({
					sessionsDir,
					currentSessionFile,
					sessionId: currentSessionId
				});
				if (!recoveredSessionFile) continue;
				currentSessionFile = recoveredSessionFile;
				log.debug("Found previous session file", { file: currentSessionFile });
				break;
			}
		}
		log.debug("Session context resolved", {
			sessionId: currentSessionId,
			sessionFile: currentSessionFile,
			hasCfg: Boolean(cfg)
		});
		const sessionFile = currentSessionFile || void 0;
		const hookConfig = resolveHookConfig(cfg, "session-memory");
		const messageCount = typeof hookConfig?.messages === "number" && hookConfig.messages > 0 ? hookConfig.messages : 15;
		let slug = null;
		let sessionContent = null;
		if (sessionFile) {
			sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
			log.debug("Session content loaded", {
				length: sessionContent?.length ?? 0,
				messageCount
			});
			const allowLlmSlug = !(process.env.OPENCLAW_TEST_FAST === "1" || process.env.VITEST === "true" || process.env.VITEST === "1" || false) && hookConfig?.llmSlug !== false;
			if (sessionContent && cfg && allowLlmSlug) {
				log.debug("Calling generateSlugViaLLM...");
				slug = await generateSlugViaLLM({
					sessionContent,
					cfg
				});
				log.debug("Generated slug", { slug });
			}
		}
		if (!slug) {
			slug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "").slice(0, 4);
			log.debug("Using fallback timestamp slug", { slug });
		}
		const filename = `${dateStr}-${slug}.md`;
		const memoryFilePath = path.join(memoryDir, filename);
		log.debug("Memory file path resolved", {
			filename,
			path: memoryFilePath.replace(os.homedir(), "~")
		});
		const timeStr = now.toISOString().split("T")[1].split(".")[0];
		const sessionId = sessionEntry.sessionId || "unknown";
		const source = context.commandSource || "unknown";
		const entryParts = [
			`# Session: ${dateStr} ${timeStr} UTC`,
			"",
			`- **Session Key**: ${event.sessionKey}`,
			`- **Session ID**: ${sessionId}`,
			`- **Source**: ${source}`,
			""
		];
		if (sessionContent) entryParts.push("## Conversation Summary", "", sessionContent, "");
		const entry = entryParts.join("\n");
		await fs.writeFile(memoryFilePath, entry, "utf-8");
		log.debug("Memory file written successfully");
		const relPath = memoryFilePath.replace(os.homedir(), "~");
		log.info(`Session context saved to ${relPath}`);
	} catch (err) {
		if (err instanceof Error) log.error("Failed to save session memory", {
			errorName: err.name,
			errorMessage: err.message,
			stack: err.stack
		});
		else log.error("Failed to save session memory", { error: String(err) });
	}
};

//#endregion
export { saveSessionToMemory as default };