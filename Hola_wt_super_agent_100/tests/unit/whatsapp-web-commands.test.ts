import { describe, expect, it } from 'vitest';
import { parseWhatsAppCommand, stripIliaMentionPrefix } from '../../server/integrations/whatsappWebCommands';

describe('whatsappWebCommands', () => {
  it('strips ILIA mention prefix', () => {
    expect(stripIliaMentionPrefix('ILIA hola')).toEqual({ mentioned: true, cleanedText: 'hola' });
    expect(stripIliaMentionPrefix('  ilia:   hola  ')).toEqual({ mentioned: true, cleanedText: 'hola' });
    expect(stripIliaMentionPrefix('@ILIA, hola')).toEqual({ mentioned: true, cleanedText: 'hola' });
    expect(stripIliaMentionPrefix('Hola ILIA')).toEqual({ mentioned: false, cleanedText: 'Hola ILIA' });
    expect(stripIliaMentionPrefix('ILIA')).toEqual({ mentioned: true, cleanedText: '' });
  });

  it('parses pairing and basic commands', () => {
    expect(parseWhatsAppCommand('PAIR ABCD1234EF56')).toEqual({ type: 'pair', code: 'ABCD1234EF56' });
    expect(parseWhatsAppCommand('ilia pair abcd')).toEqual({ type: 'pair', code: 'ABCD' });
    expect(parseWhatsAppCommand('/help')).toEqual({ type: 'help' });
    expect(parseWhatsAppCommand('ILIA STATUS')).toEqual({ type: 'status' });
    expect(parseWhatsAppCommand('stop')).toEqual({ type: 'stop' });
    expect(parseWhatsAppCommand('start')).toEqual({ type: 'start' });
    expect(parseWhatsAppCommand('unpair')).toEqual({ type: 'unpair' });
  });

  it('parses chat control commands', () => {
    expect(parseWhatsAppCommand('CHATS')).toEqual({ type: 'chats', limit: undefined });
    expect(parseWhatsAppCommand('ILIA: CHATS 15')).toEqual({ type: 'chats', limit: 15 });
    expect(parseWhatsAppCommand('OPEN 2')).toEqual({ type: 'open', index: 2 });
    expect(parseWhatsAppCommand('PIN 3')).toEqual({ type: 'pin', index: 3 });
    expect(parseWhatsAppCommand('UNPIN 4')).toEqual({ type: 'unpin', index: 4 });
    expect(parseWhatsAppCommand('ARCHIVE 5')).toEqual({ type: 'archive', index: 5 });
    expect(parseWhatsAppCommand('UNARCHIVE 6')).toEqual({ type: 'unarchive', index: 6 });
    expect(parseWhatsAppCommand('OPEN 0')).toEqual({ type: 'open', index: 0 });
  });

  it('returns none for unknown input', () => {
    expect(parseWhatsAppCommand('something else')).toEqual({ type: 'none' });
    expect(parseWhatsAppCommand('')).toEqual({ type: 'none' });
  });
});

