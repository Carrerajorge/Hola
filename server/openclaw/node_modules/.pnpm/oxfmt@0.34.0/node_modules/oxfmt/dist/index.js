import { n as jsTextToDoc$1, t as format$1 } from "./bindings-DTOgpISZ.js";
import { i as sortTailwindClasses, n as formatFile, r as resolvePlugins, t as formatEmbeddedCode } from "./apis-Ddb0m55g.js";

//#region src-js/index.ts
/**
* Format the given source text according to the specified options.
*/
async function format(fileName, sourceText, options) {
	if (typeof fileName !== "string") throw new TypeError("`fileName` must be a string");
	if (typeof sourceText !== "string") throw new TypeError("`sourceText` must be a string");
	return format$1(fileName, sourceText, options ?? {}, resolvePlugins, (options, code) => formatEmbeddedCode({
		options,
		code
	}), (options, code) => formatFile({
		options,
		code
	}), (options, classes) => sortTailwindClasses({
		options,
		classes
	}));
}
/**
* Format a JS/TS snippet for Prettier `textToDoc()` plugin flow.
*/
async function jsTextToDoc(fileName, sourceText, oxfmtPluginOptionsJson, parentContext) {
	return jsTextToDoc$1(fileName, sourceText, oxfmtPluginOptionsJson, parentContext, resolvePlugins, (options, code) => formatEmbeddedCode({
		options,
		code
	}), (_options, _code) => Promise.reject(), (options, classes) => sortTailwindClasses({
		options,
		classes
	}));
}

//#endregion
export { format, jsTextToDoc };