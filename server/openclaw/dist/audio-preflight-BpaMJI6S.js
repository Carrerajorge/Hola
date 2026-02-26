import "./paths-B4BZAPZh.js";
import { F as shouldLogVerbose, M as logVerbose } from "./utils-DCtXtPui.js";
import "./thinking-EAliFiVK.js";
import "./agent-scope-CetJgM-R.js";
import "./subsystem-DkqfG4LL.js";
import "./exec-BvIdloyw.js";
import "./model-selection-BGu7OGe6.js";
import "./github-copilot-token-nncItI8D.js";
import "./boolean-BgXe2hyu.js";
import "./env-BxJiM21b.js";
import "./host-env-security-ljCLeQmh.js";
import "./message-channel-D8ATLuBC.js";
import "./config-Cix160T5.js";
import "./env-vars-CvvqezS9.js";
import "./manifest-registry-UIPJjw6g.js";
import "./dock-D5PDfAsH.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, s as isAudioAttachment, t as buildProviderRegistry } from "./runner-BWvU_k4C.js";
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
import "./sessions-B9yXoHO1.js";
import "./plugins-D4Ns2yTE.js";
import "./accounts-DFYKAwz0.js";
import "./accounts-Bw3VhFrr.js";
import "./accounts-Bs5Igj-6.js";
import "./bindings-CfY5TcJm.js";
import "./logging-B-Pt-Wis.js";
import "./paths-DI5fQaUg.js";
import "./chat-envelope-CurikSJo.js";
import "./tool-images-Dw_AqSiB.js";
import "./tool-display-BNnsnxQh.js";
import "./fetch-guard-Dh7-G6dE.js";
import "./api-key-rotation-C-Ymilxh.js";
import "./local-roots-DfZXlYAW.js";
import "./model-catalog-0q2XBRrT.js";

//#region src/media-understanding/audio-preflight.ts
/**
* Transcribes the first audio attachment BEFORE mention checking.
* This allows voice notes to be processed in group chats with requireMention: true.
* Returns the transcript or undefined if transcription fails or no audio is found.
*/
async function transcribeFirstAudio(params) {
	const { ctx, cfg } = params;
	const audioConfig = cfg.tools?.media?.audio;
	if (!audioConfig || audioConfig.enabled === false) return;
	const attachments = normalizeMediaAttachments(ctx);
	if (!attachments || attachments.length === 0) return;
	const firstAudio = attachments.find((att) => att && isAudioAttachment(att) && !att.alreadyTranscribed);
	if (!firstAudio) return;
	if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribing attachment ${firstAudio.index} for mention check`);
	const providerRegistry = buildProviderRegistry(params.providers);
	const cache = createMediaAttachmentCache(attachments, { localPathRoots: resolveMediaAttachmentLocalRoots({
		cfg,
		ctx
	}) });
	try {
		const result = await runCapability({
			capability: "audio",
			cfg,
			ctx,
			attachments: cache,
			media: attachments,
			agentDir: params.agentDir,
			providerRegistry,
			config: audioConfig,
			activeModel: params.activeModel
		});
		if (!result || result.outputs.length === 0) return;
		const audioOutput = result.outputs.find((output) => output.kind === "audio.transcription");
		if (!audioOutput || !audioOutput.text) return;
		firstAudio.alreadyTranscribed = true;
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcribed ${audioOutput.text.length} chars from attachment ${firstAudio.index}`);
		return audioOutput.text;
	} catch (err) {
		if (shouldLogVerbose()) logVerbose(`audio-preflight: transcription failed: ${String(err)}`);
		return;
	} finally {
		await cache.cleanup();
	}
}

//#endregion
export { transcribeFirstAudio };