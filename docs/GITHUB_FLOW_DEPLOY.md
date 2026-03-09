# GitHub Flow + Auto Deploy

This repository is set up for a PR-first deployment flow:

1. Create a feature branch from `main`
2. Push the branch to GitHub
3. Open a pull request into `main`
4. Let CI run on the PR
5. Preview deploy runs for the PR
6. Merge the PR into `main`
7. Production deploy runs automatically from the `main` push

## Required GitHub Setup

Run these once from a machine that has `gh` CLI access to the repository:

```bash
bash scripts/setup-github-secrets.sh
bash scripts/setup-branch-protection.sh
```

What this gives you:

- `preview.yml` deploys a per-PR preview slot
- `ci.yml` validates lint, types, and tests on PRs and `main`
- `deploy.yml` deploys production automatically after merge to `main`
- branch protection blocks direct pushes to `main`

## Daily Workflow

```bash
git checkout main
git pull origin main
git checkout -b feat/your-feature

# make changes
npm run type-check
npm run test:run

git add .
git commit -m "feat: your feature"
git push -u origin feat/your-feature
```

Open a PR to `main`.

After merge:

- GitHub Actions builds and pushes Docker images to GHCR
- The production workflow deploys the merged commit to the VPS
- Blue-green checks verify the new slot before traffic switches

## Recommended Repository Settings

- Protect `main`
- Require pull request before merging
- Require at least 1 approval
- Require status checks: `Lint & Typecheck`, `Unit Testing`
- Require conversation resolution
- Disable force pushes
- Disable branch deletion

## Important Secrets

- `VPS_SSH_KEY_B64`
- `VPS_HOST`
- `VPS_USER`
- `VPS_PORT`
- `DEPLOY_PATH`

## Manual Fallback

If you need to deploy manually without waiting for a merge:

```bash
gh workflow run deploy.yml
```

If you need direct production verification:

```bash
npm run verify:prod
```
