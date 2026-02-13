import { exportAcademicArticlesFromPrompt } from "../services/academicArticlesExport";
import fs from "fs/promises";
import path from "path";

const prompt = "buscarme 100 articulos cientificos solo de latinoamerica y españa sobre Impacto de la economía circular en la cadena de suministro de una empresas exportadora del 2021 al 2025 y colocalo en un excel ordenado por Authors Title Year Journal Abstract Keywords Language Document Type DOI City of publication Country of study Scopus. Y luego las citas en apa 7am edicion y colocalo en un word.";

const outDir = path.join(process.cwd(), "artifacts", "academic_export");
await fs.mkdir(outDir, { recursive: true });

const started = Date.now();
const result = await exportAcademicArticlesFromPrompt(prompt);
const ts = new Date().toISOString().replace(/[:.]/g, "-");

const excelPath = path.join(outDir, `articulos_latam_espana_2021_2025_${ts}.xlsx`);
const wordPath = path.join(outDir, `citas_apa7_latam_espana_2021_2025_${ts}.docx`);
const summaryPath = path.join(outDir, `resumen_${ts}.json`);

await fs.writeFile(excelPath, result.excelBuffer);
await fs.writeFile(wordPath, result.wordBuffer);

const summary = {
  elapsedMs: Date.now() - started,
  plan: result.plan,
  stats: result.stats,
  debug: result.debug,
  files: { excelPath, wordPath }
};

await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

console.log(JSON.stringify({
  ok: true,
  elapsedMs: summary.elapsedMs,
  totalRequested: result.stats.totalRequested,
  totalReturned: result.stats.totalReturned,
  coverage: result.stats.coverage,
  bySource: result.stats.bySource,
  notes: result.stats.notes,
  files: { excelPath, wordPath, summaryPath }
}, null, 2));
