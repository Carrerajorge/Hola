# Eval Harness (LLM-as-a-Judge)

Este directorio contiene un harness de evaluacion para el pipeline:

`brief -> retrieval (RAG) -> answer -> verifier -> judge`

Genera:
- traces por caso (brief, evidencia, RAG top-k, verificacion, judge)
- metricas agregadas (task success, tasa de aclaraciones, cobertura de citas, contradicciones)
- opcion de baseline/compare para detectar regresiones en CI

## Ejecutar

Modo offline (sin llamadas a LLM; usa brief fallback + heuristicas):

```bash
npm run eval:judge
```

Modo LLM (requiere un API key configurado: `XAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` o `ANTHROPIC_API_KEY`):

```bash
npm run eval:judge:llm
```

Outputs:
- `test_results/eval_judge_latest.json`
- `test_results/eval_judge_latest.md`

## Baseline y regresiones

Guardar baseline (por defecto en `evals/judge_baseline.json`):

```bash
npm run eval:judge -- --mode offline --save-baseline evals/judge_baseline.json
```

Comparar contra baseline y fallar si hay regresiones:

```bash
npm run eval:judge -- --mode offline --baseline evals/judge_baseline.json
```

Ajustar tolerancias (defaults: `task_success_drop=0.03`, `citation_drop=0.03`, `clarification_increase=0.05`, `contradictions_increase=0.1`):

```bash
npm run eval:judge -- --mode offline \\
  --baseline evals/judge_baseline.json \\
  --max-task-success-drop 0.02 \\
  --max-citation-coverage-drop 0.02 \\
  --max-clarification-increase 0.03 \\
  --max-contradictions-increase 0.05
```

Si queres comparar sin cortar el proceso (solo reporte), agrega:

```bash
npm run eval:judge -- --mode offline --baseline evals/judge_baseline.json --no-fail
```

Notas:
- El baseline es compatible con modo LLM tambien, pero CI corre por defecto en modo offline para evitar flakiness por providers.
- `casesPath` se guarda en formato relativo (portable) para que el baseline sea estable entre local/CI.
