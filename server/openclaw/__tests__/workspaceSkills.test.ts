import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadWorkspaceSkills } from '../skills/workspace';
import * as fs from 'fs';
import * as path from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('loadWorkspaceSkills', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'skills-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load skill files from directory', async () => {
    writeFileSync(path.join(tempDir, 'test-skill.md'), `---
name: Test Skill
description: A test skill
---
# Test Skill
You are a test skill that does testing.`);

    const skills = await loadWorkspaceSkills(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Test Skill');
    expect(skills[0].source).toBe('workspace');
    expect(skills[0].prompt).toContain('# Test Skill');
  });

  it('should return empty array for empty directory', async () => {
    const skills = await loadWorkspaceSkills(tempDir);
    expect(skills).toHaveLength(0);
  });

  it('should return empty array for non-existent directory', async () => {
    const skills = await loadWorkspaceSkills('/tmp/nonexistent-dir-12345');
    expect(skills).toHaveLength(0);
  });

  it('should use filename as skill ID', async () => {
    writeFileSync(path.join(tempDir, 'my-cool-skill.md'), `---
name: Cool
description: Cool skill
---
Do cool things`);

    const skills = await loadWorkspaceSkills(tempDir);
    expect(skills[0].id).toBe('my-cool-skill');
  });
});
