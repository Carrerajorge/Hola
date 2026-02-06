import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import crypto from 'crypto';
import {
  generatePairingCode,
  getWhatsAppWebUserDir,
  loadWhatsAppWebSettings,
  settingsForClient,
} from '../../server/integrations/whatsappWebSettings';

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('whatsappWebSettings', () => {
  it('defaults mentionOnly to true', () => {
    const userId = `test_${crypto.randomUUID()}`;
    const dir = getWhatsAppWebUserDir(userId);
    createdDirs.push(dir);

    const settings = loadWhatsAppWebSettings(userId);
    expect(settings.autoReply.mentionOnly).toBe(true);
    expect(settings.autoReply.enabled).toBe(false);

    const client = settingsForClient(settings);
    expect(client.mentionOnly).toBe(true);
  });

  it('generates a 12-hex pairing code', () => {
    const userId = `test_${crypto.randomUUID()}`;
    const dir = getWhatsAppWebUserDir(userId);
    createdDirs.push(dir);

    const { code } = generatePairingCode(userId);
    expect(code).toMatch(/^[A-F0-9]{12}$/);
  });
});

