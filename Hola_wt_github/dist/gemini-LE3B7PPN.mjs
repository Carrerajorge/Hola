import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{a,b,c,d,e}from"./chunk-OSMGEPUI.mjs";import"./chunk-2FP5DEJW.mjs";export{c as GEMINI_MODELS,d as geminiChat,e as geminiStreamChat,a as getGeminiClient,b as getGeminiClientOrThrow};
