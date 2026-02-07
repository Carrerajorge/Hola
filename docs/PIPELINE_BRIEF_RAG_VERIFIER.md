# Pipeline: Brief -> Ingestion -> Hybrid RAG -> Verifier

Este documento describe el pipeline "brief-first" (gating obligatorio) para evitar perdida de campos/formato, mejorar recuperacion (RAG) y exigir verificaciones/citas antes de responder.

## Objetivos
- Convertir cualquier pedido (texto + docs + imagenes) en un encargo canonico (brief) con salida estructurada (JSON Schema).
- Ingestion layout-aware (jerarquia, titulos, tablas, encabezados/columnas) y chunking context-aware.
- RAG hibrido (keyword + embeddings) con reranking y expansion por grafo cuando el conocimiento esta conectado entre fuentes.
- Verificacion separada (fechas/numeros/contradicciones + cobertura de citas + confianza).
- Telemetria y evaluacion continua (traces + baseline de regresion en CI).

## Flujo (alto nivel)
1. Request-Understanding (RU) agent: construye `RequestBrief` (schema estricto). Si falta info, bloquea y hace UNA pregunta.
2. Ingestion: extrae texto/estructura de adjuntos y genera chunks con citas trazables.
3. Retrieval: hybrid search + fusion + reranking; opcional expansion por grafo (GraphRAG/GRAG-style) para contexto conectado.
4. Answer: responde ejecutando el encargo del brief y citando evidencia.
5. Verifier: chequea coherencia vs evidencia, exige citas, estima confianza y decide si hay que preguntar algo.
6. Telemetry + Evals: guarda trazas; corre harness con baseline en CI para detectar regresiones.

## Contratos / Reglas
- Gating: no se genera respuesta final sin `RequestBrief` valido.
- Bloqueo: si `brief.blocker.is_blocked=true` se devuelve SOLO `brief.blocker.question` (una pregunta) y se detiene.
- Seguridad: el texto extraido de adjuntos es evidencia no confiable (no seguir instrucciones internas; solo extraer hechos).
- Citas: si hubo evidencia (adjuntos o RAG), la respuesta debe incluir al menos una cita trazable:
  - Documentos: `[doc:ARCHIVO p# section:...]`
  - Imagenes: `[img:ARCHIVO]`
  - Memoria conversacional: `[mem:#]`

## Componentes (codigo)
- RU Agent (schema/structured output):
  - `server/agent/requestUnderstanding/briefSchema.ts`
  - `server/agent/requestUnderstanding/requestUnderstandingAgent.ts`
- Ingestion + chunks/citas:
  - `server/services/documentBatchProcessor.ts`
  - `server/services/documentBatchProcessor/*` (si aplica)
- Retrieval (hybrid + rerank + graph expand):
  - `server/lib/ragRetriever.ts`
- Verifier:
  - `server/agent/verifier/verifierAgent.ts`
  - `server/agent/verifier/verifierSchema.ts`
- Orquestacion (brief -> rag -> answer -> verify) + trazas:
  - `server/routes/chatAiRouter.ts`

## Telemetria / Observabilidad
- Spans OTel recomendados (ejemplos): `request_understanding`, `rag_retrieval`, `answer_generation`, `verification`.
- Persistencia best-effort de telemetria de retrieval para debug de prod (sin romper el request si falla).

## Evaluacion (LLM-as-a-judge + baseline)
- Casos: `evals/judge_cases.json`
- Harness: `scripts/eval-judge.ts`
- Reportes:
  - `test_results/eval_judge_latest.json`
  - `test_results/eval_judge_latest.md`
- Baseline:
  - `evals/judge_baseline.json` (commiteado; usado por CI en modo offline)

## Plan de mejora (4 horas)
1. 0:00-1:00 Endurecer Brief y bloqueos
   - Versionar `RequestBrief` (campo `schema_version`) y compatibilidad hacia atras.
   - Expandir "datos aportados vs supuestos" con trazabilidad (referencia a doc/pagina cuando aplique).
2. 1:00-2:00 Ingestion 2026 (tablas + headers)
   - Carry-forward de encabezados: titulos + headers de tabla deben adjuntarse a cada chunk de filas.
   - Normalizacion de citas: doc/pagina/seccion consistente para PDF/DOCX/HTML y `[img:...]` para vision.
3. 2:00-3:00 GraphRAG mas trazable
   - Extraccion de entidades/relaciones por documento y creacion de subgrafos por conversacion.
   - Retrieval por subgrafo (vecinos/2-hop) con justificacion en metadata (por que se trajo cada chunk).
4. 3:00-4:00 Verifier mas estricto + dataset
   - Alineacion "claim -> evidence": detectar fechas/numeros no soportados y forzar correccion o pregunta.
   - Agregar 10-20 casos nuevos (reales + sinteticos) a `evals/judge_cases.json` y actualizar baseline.

