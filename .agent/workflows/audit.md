---
description: Run continuous improvement audit on MICHAT
---
// turbo-all

# MICHAT Continuous Improvement Workflow

This workflow analyzes the codebase, identifies critical issues, and implements fixes automatically.

## Phase 1: Audit

1. Run TypeScript type check: `npx tsc --noEmit 2>&1 | head -50`
2. Check for lint errors: `npm run lint 2>&1 | head -30`
3. Analyze bundle size: `npm run build 2>&1 | grep -E "(chunk|size|warning)" | head -20`
4. Review server logs for errors (if available)

## Phase 2: Identify Critical Issues

Priority order:

1. **P0 - Breaking**: Runtime errors, crashes, security vulnerabilities
2. **P1 - High**: Type errors, missing error handling, performance issues
3. **P2 - Medium**: Code duplication, outdated patterns, missing tests
4. **P3 - Low**: Style issues, documentation, minor optimizations

## Phase 3: Implementation

For each issue:

1. Create a fix plan
2. Implement the fix
3. Verify the fix works
4. Commit with descriptive message

## Phase 4: Deploy

1. Push changes to Git
2. Notify user to pull on VPS: `git pull && npm run build && pm2 restart michat`

## Phase 5: Repeat

After completing one cycle, start Phase 1 again with fresh analysis.

## Stop Conditions

- User says "stop" or "pause"
- 10 improvements completed in one session
- No more P0/P1 issues found
