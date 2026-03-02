import { r as runCli } from "./bindings-DTOgpISZ.js";
import { r as resolvePlugins } from "./apis-Ddb0m55g.js";
import Tinypool from "tinypool";

//#region src-js/cli/worker-proxy.ts
let pool = null;
async function initExternalFormatter(numThreads) {
	pool = new Tinypool({
		filename: new URL("./cli-worker.js", import.meta.url).href,
		minThreads: numThreads,
		maxThreads: numThreads,
		runtime: "child_process",
		env: process.env
	});
	return resolvePlugins();
}
async function disposeExternalFormatter() {
	await pool?.destroy();
	pool = null;
}
async function formatEmbeddedCode(options, code) {
	return pool.run({
		options,
		code
	}, { name: "formatEmbeddedCode" });
}
async function formatFile(options, code) {
	return pool.run({
		options,
		code
	}, { name: "formatFile" });
}
async function sortTailwindClasses(options, classes) {
	return pool.run({
		classes,
		options
	}, { name: "sortTailwindClasses" });
}

//#endregion
//#region src-js/cli.ts
(async () => {
	const args = process.argv.slice(2);
	if (!process.stdout.isTTY) process.stdout._handle?.setBlocking?.(true);
	const [mode, exitCode] = await runCli(args, initExternalFormatter, formatEmbeddedCode, formatFile, sortTailwindClasses);
	if (mode === "init") {
		await import("./init-BlnymtNS.js").then((m) => m.runInit());
		return;
	}
	if (mode === "migrate:prettier") {
		await import("./migrate-prettier-CPi8N90o.js").then((m) => m.runMigratePrettier());
		return;
	}
	if (mode === "migrate:biome") {
		await import("./migrate-biome-B4fq26fI.js").then((m) => m.runMigrateBiome());
		return;
	}
	await disposeExternalFormatter();
	process.exitCode = exitCode;
	const [major, minor] = process.versions.node.split(".").map(Number);
	if (major < 25 || major === 25 && minor < 4) setTimeout(() => process.exit(), 50);
})();

//#endregion
export {  };