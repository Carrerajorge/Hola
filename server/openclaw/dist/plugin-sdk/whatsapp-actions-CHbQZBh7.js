import { r as resolveWhatsAppAccount } from "./accounts-BKKD4hJZ.js";
import "./paths-DVWx7USN.js";
import "./github-copilot-token-Cg0YPPSu.js";
import "./plugins-BcZyqZ2i.js";
import "./subsystem-DDlKm7JR.js";
import "./config-0er5lK-Y.js";
import "./command-format-CSkgHwwD.js";
import "./model-selection-CfBXvztJ.js";
import "./agent-scope-S0PcYLol.js";
import "./manifest-registry-J3QGS9aQ.js";
import "./image-ops-DukJmgIX.js";
import "./ssrf-DPlHrEn9.js";
import "./fetch-guard-C8dbOA2p.js";
import "./local-roots-3Xef4JBF.js";
import "./ir-DQ4F9r9S.js";
import "./chunk-BNhTPGBO.js";
import "./message-channel-CkSgoFcf.js";
import "./bindings-CYy12UhO.js";
import "./markdown-tables-G3uY5lDR.js";
import "./render-3_VJ30aR.js";
import "./tables-BOJ0WJO4.js";
import "./tool-images-DTG_6Hc_.js";
import { a as createActionGate, c as jsonResult, d as readReactionParams, i as ToolAuthorizationError, m as readStringParam } from "./target-errors-CTguFpPy.js";
import { t as resolveWhatsAppOutboundTarget } from "./resolve-outbound-target-BRl0FB7o.js";
import { r as sendReactionWhatsApp } from "./outbound-B_5zbsvl.js";

//#region src/agents/tools/whatsapp-target-auth.ts
function resolveAuthorizedWhatsAppOutboundTarget(params) {
	const account = resolveWhatsAppAccount({
		cfg: params.cfg,
		accountId: params.accountId
	});
	const resolution = resolveWhatsAppOutboundTarget({
		to: params.chatJid,
		allowFrom: account.allowFrom ?? [],
		mode: "implicit"
	});
	if (!resolution.ok) throw new ToolAuthorizationError(`WhatsApp ${params.actionLabel} blocked: chatJid "${params.chatJid}" is not in the configured allowFrom list for account "${account.accountId}".`);
	return {
		to: resolution.to,
		accountId: account.accountId
	};
}

//#endregion
//#region src/agents/tools/whatsapp-actions.ts
async function handleWhatsAppAction(params, cfg) {
	const action = readStringParam(params, "action", { required: true });
	const isActionEnabled = createActionGate(cfg.channels?.whatsapp?.actions);
	if (action === "react") {
		if (!isActionEnabled("reactions")) throw new Error("WhatsApp reactions are disabled.");
		const chatJid = readStringParam(params, "chatJid", { required: true });
		const messageId = readStringParam(params, "messageId", { required: true });
		const { emoji, remove, isEmpty } = readReactionParams(params, { removeErrorMessage: "Emoji is required to remove a WhatsApp reaction." });
		const participant = readStringParam(params, "participant");
		const accountId = readStringParam(params, "accountId");
		const fromMeRaw = params.fromMe;
		const fromMe = typeof fromMeRaw === "boolean" ? fromMeRaw : void 0;
		const resolved = resolveAuthorizedWhatsAppOutboundTarget({
			cfg,
			chatJid,
			accountId,
			actionLabel: "reaction"
		});
		const resolvedEmoji = remove ? "" : emoji;
		await sendReactionWhatsApp(resolved.to, messageId, resolvedEmoji, {
			verbose: false,
			fromMe,
			participant: participant ?? void 0,
			accountId: resolved.accountId
		});
		if (!remove && !isEmpty) return jsonResult({
			ok: true,
			added: emoji
		});
		return jsonResult({
			ok: true,
			removed: true
		});
	}
	throw new Error(`Unsupported WhatsApp action: ${action}`);
}

//#endregion
export { handleWhatsAppAction };