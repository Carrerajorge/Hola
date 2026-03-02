import "./bindings-DTOgpISZ.js";
import "./apis-Ddb0m55g.js";
import { jsTextToDoc } from "./index.js";
import { r as builders } from "./prettier-DIVejRqd.js";

//#region src-js/libs/prettier-plugin-oxfmt/text-to-doc.ts
const { hardline, join } = builders;
const LINE_BREAK_RE = /\r?\n/;
const textToDoc = async (embeddedSourceText, textToDocOptions) => {
	const { parser, parentParser, filepath, _oxfmtPluginOptionsJson } = textToDocOptions;
	const { doc: formattedText, errors } = await jsTextToDoc(parser === "typescript" ? filepath.endsWith(".tsx") ? "dummy.tsx" : "dummy.ts" : "dummy.jsx", embeddedSourceText, _oxfmtPluginOptionsJson, [parentParser].join(":"));
	if (0 < errors.length) throw new Error(errors[0].message);
	return join(hardline, formattedText.split(LINE_BREAK_RE));
};

//#endregion
//#region src-js/libs/prettier-plugin-oxfmt/index.ts
/**
* Prettier plugin that uses `oxc_formatter` for (j|t)s-in-xxx part.
*
* When Prettier formats Vue/HTML (which can embed JS/TS code inside) files,
* it calls the `embed()` function for each block.
*
* By default, it uses the `babel` or `typescript` parser and `estree` printer.
* Therefore, by overriding these internally, we can use `oxc_formatter` instead.
* e.g. Now it's possible to apply our builtin sort-imports for JS/TS code inside Vue `<script>`.
*/
const options = { _oxfmtPluginOptionsJson: {
	category: "JavaScript",
	type: "string",
	default: "{}",
	description: "Bundled JSON string for oxfmt-plugin options"
} };
const oxfmtParser = {
	parse: textToDoc,
	astFormat: "OXFMT",
	locStart: () => -1,
	locEnd: () => -1
};
const parsers = {
	babel: oxfmtParser,
	typescript: oxfmtParser
};
const printers = { OXFMT: { print: ({ node }) => node } };

//#endregion
export { options, parsers, printers };