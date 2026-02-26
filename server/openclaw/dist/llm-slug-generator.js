import { c as resolveAgentWorkspaceDir, l as resolveDefaultAgentId, o as resolveAgentModelPrimary, r as resolveAgentDir } from "./agent-scope-BbLbkVXD.js";
import "./paths-C9do7WCN.js";
import { t as createSubsystemLogger } from "./subsystem-BoKOAh1n.js";
import "./workspace-PSi34tZF.js";
import { it as DEFAULT_PROVIDER, l as parseModelRef, rt as DEFAULT_MODEL } from "./model-selection-B5NjONwE.js";
import "./github-copilot-token-BkwQAVvU.js";
import "./env-Bw45uydv.js";
import "./boolean-mcn6kL0s.js";
import "./tokens-BLlPaiD5.js";
import { t as runEmbeddedPiAgent } from "./pi-embedded-CV53eKpr.js";
import "./plugins-BlRpkhyC.js";
import "./accounts-CxYlEftx.js";
import "./bindings-BCOutV7A.js";
import "./send-BF8QfC--.js";
import "./send-CBl-cFHi.js";
import "./deliver-BHbS7MPi.js";
import "./diagnostic-D_de7-KX.js";
import "./diagnostic-session-state-C0Sxjfox.js";
import "./accounts-Ci-FogVD.js";
import "./send-BEnRshK8.js";
import "./image-ops-DR7iVy0X.js";
import "./pi-model-discovery-C-yOXpma.js";
import "./message-channel-NXidGUO7.js";
import "./pi-embedded-helpers-ABBMCQ4Q.js";
import "./config-DvUlTmaK.js";
import "./manifest-registry-DARtGCWp.js";
import "./dock-Devv97xs.js";
import "./chrome-j8n4RCAx.js";
import "./ssrf-BM54dmk8.js";
import "./frontmatter-CYyVkHva.js";
import "./skills-DOKat65v.js";
import "./redact-C_vdZ7-E.js";
import "./errors-BggFlOL1.js";
import "./store-DoCZrlTi.js";
import "./sessions-BiWBZ-uj.js";
import "./accounts-DKYigdEx.js";
import "./paths-CLWDvYDE.js";
import "./tool-images-DeM5viPH.js";
import "./thinking-CJoHneR6.js";
import "./image-C3Y2REz9.js";
import "./reply-prefix-Cha4QN8H.js";
import "./manager-DkvrfiWy.js";
import "./gemini-auth-DejNVJue.js";
import "./fetch-guard-Diq4wbzK.js";
import "./query-expansion-CqHuxZ09.js";
import "./retry-CpSN4cGC.js";
import "./target-errors-C4v9HKnW.js";
import "./chunk-BK8T_RCs.js";
import "./markdown-tables-B8I8M-Et.js";
import "./local-roots-DS-8ZE_B.js";
import "./ir-DQn3JpQE.js";
import "./render-loap2gRq.js";
import "./commands-registry-CclRtEXd.js";
import "./skill-commands-6qLPyery.js";
import "./runner-RETaennS.js";
import "./fetch-CSgvhNYZ.js";
import "./channel-activity-mEN8_E9p.js";
import "./tables-DV7HmexJ.js";
import "./send-CVwZarG_.js";
import "./outbound-attachment-Bki_6KDV.js";
import "./send-C01_1hGB.js";
import "./resolve-route-BUlSpAUe.js";
import "./proxy-Bee2aKQk.js";
import "./replies-D3ifXz7i.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

//#region src/hooks/llm-slug-generator.ts
/**
* LLM-based slug generator for session memory filenames
*/
const log = createSubsystemLogger("llm-slug-generator");
/**
* Generate a short 1-2 word filename slug from session content using LLM
*/
async function generateSlugViaLLM(params) {
	let tempSessionFile = null;
	try {
		const agentId = resolveDefaultAgentId(params.cfg);
		const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
		const agentDir = resolveAgentDir(params.cfg, agentId);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-slug-"));
		tempSessionFile = path.join(tempDir, "session.jsonl");
		const prompt = `Based on this conversation, generate a short 1-2 word filename slug (lowercase, hyphen-separated, no file extension).

Conversation summary:
${params.sessionContent.slice(0, 2e3)}

Reply with ONLY the slug, nothing else. Examples: "vendor-pitch", "api-design", "bug-fix"`;
		const modelRef = resolveAgentModelPrimary(params.cfg, agentId);
		const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
		const provider = parsed?.provider ?? DEFAULT_PROVIDER;
		const model = parsed?.model ?? DEFAULT_MODEL;
		const result = await runEmbeddedPiAgent({
			sessionId: `slug-generator-${Date.now()}`,
			sessionKey: "temp:slug-generator",
			agentId,
			sessionFile: tempSessionFile,
			workspaceDir,
			agentDir,
			config: params.cfg,
			prompt,
			provider,
			model,
			timeoutMs: 15e3,
			runId: `slug-gen-${Date.now()}`
		});
		if (result.payloads && result.payloads.length > 0) {
			const text = result.payloads[0]?.text;
			if (text) return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || null;
		}
		return null;
	} catch (err) {
		const message = err instanceof Error ? err.stack ?? err.message : String(err);
		log.error(`Failed to generate slug: ${message}`);
		return null;
	} finally {
		if (tempSessionFile) try {
			await fs.rm(path.dirname(tempSessionFile), {
				recursive: true,
				force: true
			});
		} catch {}
	}
}

//#endregion
export { generateSlugViaLLM };