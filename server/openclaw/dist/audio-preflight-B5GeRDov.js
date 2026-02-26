import { St as shouldLogVerbose, yt as logVerbose } from "./entry.js";
import "./auth-profiles-Do5usXx5.js";
import "./agent-scope-BUKPOSoo.js";
import "./exec-G9-WTRVN.js";
import "./github-copilot-token-RNgXBxZS.js";
import "./host-env-security-DyQuUnEd.js";
import "./pi-model-discovery-CwESh4K1.js";
import "./frontmatter-17nP3KZr.js";
import "./skills-BY60SMEv.js";
import "./manifest-registry-BPlNBgie.js";
import "./config-Bkwnzpys.js";
import "./env-vars-iFkEK4MO.js";
import "./dock-CIOFikxK.js";
import "./message-channel-CIQTys4Q.js";
import "./sessions-ECFvKx1f.js";
import "./plugins-DiQVUE1V.js";
import "./accounts-PH1dKbVZ.js";
import "./accounts-BTB26Iiz.js";
import "./accounts-B2H0iPgD.js";
import "./bindings-DieZWR44.js";
import "./logging-CFvkxgcX.js";
import "./paths-Dvmk_rXi.js";
import "./chat-envelope-BG_U_muK.js";
import "./net-BEAjYacy.js";
import "./ip-m9Sjsn1o.js";
import "./tailnet-BOWO-AaH.js";
import "./image-ops-CdtmwUCR.js";
import "./pi-embedded-helpers-CuapwR3w.js";
import "./sandbox-CphQTZ8D.js";
import "./tool-catalog-CgUG8wjb.js";
import "./chrome-CHcnoCue.js";
import "./tailscale-B21pc9dr.js";
import "./auth-Dw00sIWu.js";
import "./server-context-BpiGFhJz.js";
import "./redact-CjuqjXFe.js";
import "./errors-DjnYuRJy.js";
import "./fs-safe-CRRUKIv2.js";
import "./trash-z9Vvqm2l.js";
import "./ssrf-BZES7RNw.js";
import "./store-B12_ELOe.js";
import "./ports-Do_TimBK.js";
import "./server-middleware-C9d3rgNn.js";
import "./tool-images-SVHV_pjn.js";
import "./thinking-DW6CKWyf.js";
import "./models-config-Br-Jfk1e.js";
import "./gemini-auth-8rJrmPae.js";
import "./fetch-guard-Cu0jqikd.js";
import "./local-roots-DqSthK0T.js";
import "./image-oQ_7PD7w.js";
import "./tool-display-DVVqZPLw.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, s as isAudioAttachment, t as buildProviderRegistry } from "./runner-D2Q8tYn3.js";
import "./model-catalog-DeOJC3gy.js";

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