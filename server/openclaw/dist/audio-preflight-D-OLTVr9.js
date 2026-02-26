import "./agent-scope-BbLbkVXD.js";
import "./paths-C9do7WCN.js";
import { J as logVerbose, Z as shouldLogVerbose } from "./subsystem-BoKOAh1n.js";
import "./workspace-PSi34tZF.js";
import "./model-selection-B5NjONwE.js";
import "./github-copilot-token-BkwQAVvU.js";
import "./env-Bw45uydv.js";
import "./boolean-mcn6kL0s.js";
import "./plugins-BlRpkhyC.js";
import "./accounts-CxYlEftx.js";
import "./bindings-BCOutV7A.js";
import "./accounts-Ci-FogVD.js";
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
import "./gemini-auth-DejNVJue.js";
import "./fetch-guard-Diq4wbzK.js";
import "./local-roots-DS-8ZE_B.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, t as buildProviderRegistry, u as isAudioAttachment } from "./runner-RETaennS.js";

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