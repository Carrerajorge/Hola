import "./agent-scope-Bhe-9aXV.js";
import "./paths-BY8fKpqm.js";
import { J as logVerbose, Z as shouldLogVerbose } from "./subsystem-n4tSscKk.js";
import "./model-selection-DDLFzohK.js";
import "./github-copilot-token-D8k4aAom.js";
import "./env-DC7b5MnK.js";
import "./plugins-YwGWnhQE.js";
import "./accounts-DvzTPeU9.js";
import "./bindings-oW5ZqVhx.js";
import "./accounts-cIBPf9IB.js";
import "./image-ops-CUmS__96.js";
import "./pi-model-discovery-DaNAekda.js";
import "./message-channel-BTrsc2pw.js";
import "./pi-embedded-helpers-BxjDtTSD.js";
import "./config-Brd46Xc7.js";
import "./manifest-registry-nhWIJO2d.js";
import "./dock-RaNO1LM5.js";
import "./chrome-C8Z3qDom.js";
import "./ssrf-ueWxHyi3.js";
import "./skills-DCqTXQZl.js";
import "./redact-CP9noGXi.js";
import "./errors-COPNX9uN.js";
import "./store-D2m05M0g.js";
import "./sessions-RdMA_tth.js";
import "./accounts-ru--5lJj.js";
import "./paths-DbuO2gD6.js";
import "./tool-images-BRXaNmBZ.js";
import "./thinking-ZaPrKXBc.js";
import "./image-Bwz7k77z.js";
import "./gemini-auth-Cg8dT8ZL.js";
import "./fetch-guard-B6-u0qUc.js";
import "./local-roots-B9aqyKN_.js";
import { a as resolveMediaAttachmentLocalRoots, n as createMediaAttachmentCache, o as runCapability, r as normalizeMediaAttachments, t as buildProviderRegistry, u as isAudioAttachment } from "./runner-yC0M8vBa.js";

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