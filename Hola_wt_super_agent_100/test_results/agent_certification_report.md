# Agent Certification Report

**Generated**: 2026-01-19T16:47:48.481Z
**Status**: ❌ FAILED

## Summary

- **Test Suites**: 1/4 passed
- **Total Tests**: 9 passed, 5 failed
- **Total Duration**: 10.33s

## Results

| Suite | Status | Duration | Tests Passed | Tests Failed |
|-------|--------|----------|--------------|-------------|
| All Agent Tests | ❌ | 8.06s | 8 | 3 |
| Benchmark Tests | ❌ | 0.86s | 0 | 1 |
| Chaos Tests | ❌ | 0.80s | 0 | 1 |
| Cache Isolation Tests | ✅ | 0.61s | 1 | 0 |

## Detailed Output

### All Agent Tests

**Command**: `npx vitest run server/agent/__tests__`

**Status**: FAILED

<details>
<summary>Output (click to expand)</summary>

```
m > [22m[2merror handling[2m > [22m[2mshould handle search errors gracefully
[22m[39m[RetrievalPipeline] Search failed: Error: Search API down
    at [90m/Users/ale/Desktop/Iliagptcom/[39mserver/agent/__tests__/webtool.test.ts:1475:43
    at [90mfile:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4m@vitest/runner[24m/dist/index.js:145:11
    at [90mfile:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4m@vitest/runner[24m/dist/index.js:915:26
    at [90mfile:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4m@vitest/runner[24m/dist/index.js:1243:20
    at new Promise (<anonymous>)
    at runWithTimeout [90m(file:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4m@vitest/runner[24m/dist/index.js:1209:10[90m)[39m
    at [90mfile:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4m@vitest/runner[24m/dist/index.js:1653:37
    at Traces.$ [90m(file:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4mvitest[24m/dist/chunks/traces.U4xDYhzZ.js:115:27[90m)[39m
    at trace [90m(file:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4mvitest[24m/dist/chunks/test.B8ej_ZHS.js:239:21[90m)[39m
    at runTest [90m(file:///Users/ale/Desktop/Iliagptcom/[39mnode_modules/[4m@vitest/runner[24m/dist/index.js:1653:12[90m)[39m

[90mstderr[2m | server/agent/__tests__/webtool.test.ts[2m > [22m[2mSandbox Security Integration[2m > [22m[2mFetchAdapter security[2m > [22m[2mshould block hosts not in allowlist
[22m[39m[FetchAdapter] Host blocked by sandbox security: blocked-host.com

[90mstderr[2m | server/agent/__tests__/webtool.test.ts[2m > [22m[2mSandbox Security Integration[2m > [22m[2mFetchAdapter security[2m > [22m[2mshould return false for invalid URLs in isUrlAllowed
[22m[39m[Validation] FetchAdapter.isUrlAllowed failed: [
  {
    code: [32m'too_small'[39m,
    minimum: [33m1[39m,
    type: [32m'string'[39m,
    inclusive: [33mtrue[39m,
    exact: [33mfalse[39m,
    message: [32m'String must contain at least 1 character(s)'[39m,
    path: []
  }
]

[90mstderr[2m | server/agent/__tests__/webtool.test.ts[2m > [22m[2mSandbox Security Integration[2m > [22m[2mBrowserAdapter security[2m > [22m[2mshould block hosts not in allowlist
[22m[39m[BrowserAdapter] Host blocked by sandbox security: blocked-host.com

[90mstderr[2m | server/agent/__tests__/webtool.test.ts[2m > [22m[2mZod validation[2m > [22m[2mcanonicalizeUrl input validation[2m > [22m[2mshould throw on empty string input
[22m[39m[Validation] canonicalizeUrl failed: [
  {
    code: [32m'too_small'[39m,
    minimum: [33m1[39m,
    type: [32m'string'[39m,
    inclusive: [33mtrue[39m,
    exact: [33mfalse[39m,
    message: [32m'String must contain at least 1 character(s)'[39m,
    path: []
  }
]

[90mstderr[2m | server/agent/__tests__/webtool.test.ts[2m > [22m[2mZod validation[2m > [22m[2mcanonicalizeUrl input validation[2m > [22m[2mshould throw on null input
[22m[39m[Validation] canonicalizeUrl failed: [
  {
    code: [32m'invalid_type'[39m,
    expected: [32m'string'[39m,
    received: [32m'null'[39m,
    path: [],
    message: [32m'Expected string, received null'[39m
  }
]

[90mstderr[2m | server/agent/__tests__/webtool.test.ts[2m > [22m[2mZod validation[2m > [22m[2mcanonicalizeUrl input validation[2m > [22m[2mshould throw on undefined input
[22m[39m[Validation] canonicalizeUrl failed: [
  {
    code: [32m'invalid_type'[39m,
    expected: [32m'string'[39m,
    received: [32m'undefined'[39m,
    path: [],
    message: [32m'Required'[39m
  }
]


[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Suites 3 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m server/agent/__tests__/agent.test.ts[2m [ server/agent/__tests__/agent.test.ts ][22m
[41m[1m FAIL [22m[49m server/agent/__tests__/benchmarks.test.ts[2m [ server/agent/__tests__/benchmarks.test.ts ][22m
[41m[1m FAIL [22m[49m server/agent/__tests__/chaos.test.ts[2m [ server/agent/__tests__/chaos.test.ts ][22m
[31m[1mError[22m: Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.[39m
[90m [2m❯[22m new OpenAI node_modules/openai/client.mjs:[2m89:19[22m[39m
[36m [2m❯[22m server/lib/openai.ts:[2m3:23[22m[39m
    [90m  1| [39m[35mimport[39m [33mOpenAI[39m [35mfrom[39m [32m"openai"[39m[33m;[39m
    [90m  2| [39m
    [90m  3| [39m[35mexport[39m [35mconst[39m openai [33m=[39m [35mnew[39m [33mOpenAI[39m({ 
    [90m   | [39m                      [31m^[39m
    [90m  4| [39m  baseURL[33m:[39m [32m"https://api.x.ai/v1"[39m[33m,[39m 
    [90m  5| [39m  apiKey[33m:[39m process[33m.[39menv[33m.[39m[33mXAI_API_KEY[39m 
[90m [2m❯[22m server/lib/llmGateway.ts:[2m3:1[22m[39m
[90m [2m❯[22m server/services/spreadsheetLlmAgent.ts:[2m1:1[22m[39m
[90m [2m❯[22m server/services/analysisOrchestrator.ts:[2m22:1[22m[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯[22m[39m


```

</details>

### Benchmark Tests

**Command**: `npx vitest run server/agent/__tests__/benchmarks.test.ts`

**Status**: FAILED

<details>
<summary>Output (click to expand)</summary>

```

[1m[46m RUN [49m[22m [36mv4.0.16 [39m[90m/Users/ale/Desktop/Iliagptcom[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[90m (1)[39m
[2m      Tests [22m [2mno tests[22m
[2m   Start at [22m 11:47:46
[2m   Duration [22m 449ms[2m (transform 133ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)[22m

[90mstderr[2m | server/agent/__tests__/benchmarks.test.ts
[22m[39m[WARNING] DATABASE_URL is not set. Database operations will fail.


[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Suites 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m server/agent/__tests__/benchmarks.test.ts[2m [ server/agent/__tests__/benchmarks.test.ts ][22m
[31m[1mError[22m: Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.[39m
[90m [2m❯[22m new OpenAI node_modules/openai/client.mjs:[2m89:19[22m[39m
[36m [2m❯[22m server/lib/openai.ts:[2m3:23[22m[39m
    [90m  1| [39m[35mimport[39m [33mOpenAI[39m [35mfrom[39m [32m"openai"[39m[33m;[39m
    [90m  2| [39m
    [90m  3| [39m[35mexport[39m [35mconst[39m openai [33m=[39m [35mnew[39m [33mOpenAI[39m({ 
    [90m   | [39m                      [31m^[39m
    [90m  4| [39m  baseURL[33m:[39m [32m"https://api.x.ai/v1"[39m[33m,[39m 
    [90m  5| [39m  apiKey[33m:[39m process[33m.[39menv[33m.[39m[33mXAI_API_KEY[39m 
[90m [2m❯[22m server/lib/llmGateway.ts:[2m3:1[22m[39m
[90m [2m❯[22m server/services/spreadsheetLlmAgent.ts:[2m1:1[22m[39m
[90m [2m❯[22m server/services/analysisOrchestrator.ts:[2m22:1[22m[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m


```

</details>

### Chaos Tests

**Command**: `npx vitest run server/agent/__tests__/chaos.test.ts`

**Status**: FAILED

<details>
<summary>Output (click to expand)</summary>

```

[1m[46m RUN [49m[22m [36mv4.0.16 [39m[90m/Users/ale/Desktop/Iliagptcom[39m


[2m Test Files [22m [1m[31m1 failed[39m[22m[90m (1)[39m
[2m      Tests [22m [2mno tests[22m
[2m   Start at [22m 11:47:47
[2m   Duration [22m 415ms[2m (transform 139ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)[22m

[90mstderr[2m | server/agent/__tests__/chaos.test.ts
[22m[39m[WARNING] DATABASE_URL is not set. Database operations will fail.


[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Suites 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m server/agent/__tests__/chaos.test.ts[2m [ server/agent/__tests__/chaos.test.ts ][22m
[31m[1mError[22m: Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable.[39m
[90m [2m❯[22m new OpenAI node_modules/openai/client.mjs:[2m89:19[22m[39m
[36m [2m❯[22m server/lib/openai.ts:[2m3:23[22m[39m
    [90m  1| [39m[35mimport[39m [33mOpenAI[39m [35mfrom[39m [32m"openai"[39m[33m;[39m
    [90m  2| [39m
    [90m  3| [39m[35mexport[39m [35mconst[39m openai [33m=[39m [35mnew[39m [33mOpenAI[39m({ 
    [90m   | [39m                      [31m^[39m
    [90m  4| [39m  baseURL[33m:[39m [32m"https://api.x.ai/v1"[39m[33m,[39m 
    [90m  5| [39m  apiKey[33m:[39m process[33m.[39menv[33m.[39m[33mXAI_API_KEY[39m 
[90m [2m❯[22m server/lib/llmGateway.ts:[2m3:1[22m[39m
[90m [2m❯[22m server/services/spreadsheetLlmAgent.ts:[2m1:1[22m[39m
[90m [2m❯[22m server/services/analysisOrchestrator.ts:[2m22:1[22m[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m


```

</details>

### Cache Isolation Tests

**Command**: `npx vitest run server/agent/__tests__/webtool-cache-isolation.test.ts`

**Status**: PASSED

<details>
<summary>Output (click to expand)</summary>

```

[1m[46m RUN [49m[22m [36mv4.0.16 [39m[90m/Users/ale/Desktop/Iliagptcom[39m

 [32m✓[39m server/agent/__tests__/webtool-cache-isolation.test.ts [2m([22m[2m26 tests[22m[2m)[22m[32m 107[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m26 passed[39m[22m[90m (26)[39m
[2m   Start at [22m 11:47:48
[2m   Duration [22m 253ms[2m (transform 41ms, setup 0ms, import 54ms, tests 107ms, environment 0ms)[22m


```

</details>

---
*Report generated by agent:certify*
