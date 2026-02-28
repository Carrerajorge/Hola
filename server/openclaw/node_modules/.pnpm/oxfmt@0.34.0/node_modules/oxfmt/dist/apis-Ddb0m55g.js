//#region src-js/libs/apis.ts
let prettierCache;
async function loadPrettier() {
	if (prettierCache) return prettierCache;
	prettierCache = await import("./prettier-DIVejRqd.js").then((n) => n.n);
	return prettierCache;
}
/**
* TODO: Plugins support
* - Read `plugins` field
* - Load plugins dynamically and parse `languages` field
* - Map file extensions and filenames to Prettier parsers
*
* @returns Array of loaded plugin's `languages` info
*/
async function resolvePlugins() {
	return [];
}
/**
* Format xxx-in-js code snippets
*
* @returns Formatted code snippet
* TODO: In the future, this should return `Doc` instead of string,
* otherwise, we cannot calculate `printWidth` correctly.
*/
async function formatEmbeddedCode({ code, options }) {
	const prettier = await loadPrettier();
	await setupTailwindPlugin(options);
	return prettier.format(code, options);
}
/**
* Format non-js file
*
* @returns Formatted code
*/
async function formatFile({ code, options }) {
	const prettier = await loadPrettier();
	await setupTailwindPlugin(options);
	await setupOxfmtPlugin(options);
	return prettier.format(code, options);
}
let tailwindPluginCache;
async function loadTailwindPlugin() {
	if (tailwindPluginCache) return tailwindPluginCache;
	tailwindPluginCache = await import("./dist-DQgkZSFc.js");
	return tailwindPluginCache;
}
/**
* Load Tailwind CSS plugin lazily when `options._useTailwindPlugin` flag is set.
* The flag is added by Rust side only for relevant parsers.
*
* Option mapping (experimentalTailwindcss.xxx → tailwindXxx) is also done in Rust side.
*/
async function setupTailwindPlugin(options) {
	if ("_useTailwindPlugin" in options === false) return;
	const tailwindPlugin = await loadTailwindPlugin();
	options.plugins ??= [];
	options.plugins.push(tailwindPlugin);
}
/**
* Process Tailwind CSS classes found in JS/TS files in batch.
* @param args - Object containing classes and options (filepath is in options.filepath)
* @returns Array of sorted class strings (same order/length as input)
*/
async function sortTailwindClasses({ classes, options }) {
	const { createSorter } = await import("./sorter-CjGwXe5x.js");
	return (await createSorter({
		filepath: options.filepath,
		stylesheetPath: options.tailwindStylesheet,
		configPath: options.tailwindConfig,
		preserveWhitespace: options.tailwindPreserveWhitespace,
		preserveDuplicates: options.tailwindPreserveDuplicates
	})).sortClassAttributes(classes);
}
let oxfmtPluginCache;
async function loadOxfmtPlugin() {
	if (oxfmtPluginCache) return oxfmtPluginCache;
	oxfmtPluginCache = await import("./prettier-plugin-oxfmt-CI1pYfTP.js");
	return oxfmtPluginCache;
}
/**
* Load oxfmt plugin for js-in-xxx parsers when `options._oxfmtPluginOptionsJson` is set.
* The flag is added by Rust side only for relevant parsers.
*/
async function setupOxfmtPlugin(options) {
	if ("_oxfmtPluginOptionsJson" in options === false) return;
	const oxcPlugin = await loadOxfmtPlugin();
	options.plugins ??= [];
	options.plugins.push(oxcPlugin);
}

//#endregion
export { sortTailwindClasses as i, formatFile as n, resolvePlugins as r, formatEmbeddedCode as t };