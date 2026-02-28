import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Some dependencies still reference CommonJS globals (module/exports) even when bundled.
// When output format is ESM, these are not defined by Node.
// Provide a minimal shim to avoid runtime crashes like:
//   ReferenceError: module is not defined in ES module scope
const module = { exports: {} };
const exports = module.exports;

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{b as e}from"./chunk-JL5GVIQJ.mjs";var t,i,n,a,p,m,s,o=e(()=>{"use strict";t=["text/plain","text/markdown","text/csv","text/html","application/json","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.ms-powerpoint","image/png","image/jpeg","image/jpg","image/gif","image/bmp","image/webp","image/tiff"],i={USER_AGENT:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",ACCEPT_HTML:"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",ACCEPT_LANGUAGE:"es-ES,es;q=0.9,en;q=0.8"},n={PAGE_FETCH:2e3,SCREENSHOT_INTERVAL:1500,MAX_CONTENT_LENGTH:800,SEARCH_LLM_TIMEOUT:12e3},a={MAX_SEARCH_RESULTS:50,MAX_CONTENT_FETCH:50,EMBEDDING_BATCH_SIZE:20,MAX_EMBEDDING_INPUT:8e3,RAG_SIMILAR_CHUNKS:3,RAG_SIMILARITY_THRESHOLD:.5,MAX_FILE_SIZE_MB:100,MAX_FILE_SIZE_BYTES:100*1024*1024},p=["mi archivo","mis archivos","mi documento","mis documentos","el archivo que","el documento que","lo que sub\xED","lo que cargu\xE9","el pdf","el excel","el word","la presentaci\xF3n","seg\xFAn mi","de acuerdo a mi","bas\xE1ndote en mi","usa mi","revisa mi","analiza mi","lee mi","en mi archivo","en mis documentos","de mi archivo"],m={CHUNK_SIZE_MB:5,CHUNK_SIZE_BYTES:5*1024*1024,MAX_PARALLEL_CHUNKS:4,UPLOAD_TIMEOUT_MS:6e4},s={"text/plain":".txt","text/markdown":".md","text/csv":".csv","text/html":".html","application/json":".json","application/pdf":".pdf","application/msword":".doc","application/vnd.openxmlformats-officedocument.wordprocessingml.document":".docx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":".xlsx","application/vnd.ms-excel":".xls","application/vnd.openxmlformats-officedocument.presentationml.presentation":".pptx","application/vnd.ms-powerpoint":".ppt","image/png":".png","image/jpeg":".jpg","image/jpg":".jpg","image/gif":".gif","image/bmp":".bmp","image/webp":".webp","image/tiff":".tiff"}});export{t as a,i as b,n as c,a as d,p as e,m as f,s as g,o as h};
