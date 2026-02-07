# PR

## Summary
- What does this PR change?
- Why is it needed (prod issue / capability / hardening)?

## How To Test
- `npm ci`
- `npm run build`
- `npm run test:run`
- `npm run eval:judge -- --mode offline --baseline evals/judge_baseline.json`

## Rollout / Risk
- Risk level: low / medium / high
- Rollout plan (flags, gradual, canary, monitoring)
- Rollback plan

## Prod Checklist
- [ ] RU (Request-Understanding) gating works: brief JSON schema enforced; exactly one clarifying question when blocked
- [ ] Attachments ingestion produces traceable citations (doc/page/section or image)
- [ ] RAG retrieval is deterministic enough (hybrid + rerank) and does not leak current user message into retrieval
- [ ] Verifier enforces citation coverage + coherence checks for dates/numbers vs evidence
- [ ] Telemetry/traces present for brief -> retrieval -> answer -> verify
- [ ] `npm run build` passes
- [ ] Relevant tests updated/added and passing
- [ ] `npm run eval:judge` passes in CI (no regressions vs baseline)
- [ ] No secrets committed; no debug logs leaking PII
- [ ] DB migrations reviewed (if any)
- [ ] Observability: dashboards/alerts for error rate, latency, RU block rate, citation failures

