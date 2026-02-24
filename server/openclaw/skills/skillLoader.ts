import type { OpenClawConfig } from '../config';
import { skillRegistry } from './skillRegistry';
import { Logger } from '../../lib/logger';

export async function initSkills(_config: OpenClawConfig): Promise<void> {
  // Register built-in skills (adapted from OpenClaw's most valuable skills)

  skillRegistry.register({
    id: 'coding-agent',
    name: 'Coding Agent',
    description: 'Full programming assistant with shell, filesystem, and git capabilities',
    prompt: `You are an expert software engineer. You have access to shell execution (openclaw_exec), file reading (openclaw_read), file writing (openclaw_write), and file editing (openclaw_edit) tools.

When coding:
- Read existing files before modifying them
- Use git for version control when appropriate
- Run tests after making changes
- Handle errors gracefully
- Follow the project's existing code style`,
    tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_edit', 'openclaw_list'],
  });

  skillRegistry.register({
    id: 'github',
    name: 'GitHub Operations',
    description: 'Create issues, pull requests, review code, manage repos',
    prompt: `You can interact with GitHub using the gh CLI tool via openclaw_exec.

Common operations:
- gh issue create --title "..." --body "..."
- gh pr create --title "..." --body "..."
- gh pr list
- gh repo clone owner/repo
- gh api repos/{owner}/{repo}/issues`,
    tools: ['openclaw_exec', 'openclaw_read'],
  });

  skillRegistry.register({
    id: 'data-analysis',
    name: 'Data Analysis',
    description: 'Analyze CSV/JSON data, generate charts and reports',
    prompt: `You are a data analyst. Use Python (via openclaw_exec) to analyze data files.

Approach:
- Read data with pandas
- Perform analysis (describe, groupby, pivot)
- Generate visualizations with matplotlib/seaborn
- Save outputs to workspace`,
    tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
  });

  skillRegistry.register({
    id: 'web-scraper',
    name: 'Web Scraper',
    description: 'Scrape and extract content from websites',
    prompt: `You can scrape web content using curl or Python (requests/beautifulsoup).

Approach:
- Use curl for simple fetches
- Use Python with requests + BeautifulSoup for complex scraping
- Respect robots.txt
- Handle rate limiting`,
    tools: ['openclaw_exec', 'openclaw_write'],
  });

  skillRegistry.register({
    id: 'devops',
    name: 'DevOps Assistant',
    description: 'Docker, deployment, CI/CD, infrastructure management',
    prompt: `You are a DevOps engineer. You can manage containers, deployments, and infrastructure.

Tools available:
- docker / docker-compose for containerization
- git for version control
- curl for API calls
- Shell commands for system management

Always be careful with destructive operations.`,
    tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_list'],
  });

  Logger.info(`[OpenClaw:Skills] ${skillRegistry.list().length} skills registered`);
}
