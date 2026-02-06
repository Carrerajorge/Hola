export type WhatsAppInboundCommand =
  | { type: 'pair'; code: string }
  | { type: 'help' }
  | { type: 'status' }
  | { type: 'stop' }
  | { type: 'start' }
  | { type: 'unpair' }
  | { type: 'chats'; limit?: number }
  | { type: 'open'; index: number }
  | { type: 'pin'; index: number }
  | { type: 'unpin'; index: number }
  | { type: 'archive'; index: number }
  | { type: 'unarchive'; index: number }
  | { type: 'none' };

export function stripIliaMentionPrefix(text: string): { mentioned: boolean; cleanedText: string } {
  const raw = String(text || '');
  const re = /^\s*@?ILIA\b[\s:,_-]*/i;
  const m = raw.match(re);
  if (!m) return { mentioned: false, cleanedText: raw.trim() };
  return { mentioned: true, cleanedText: raw.slice(m[0].length).trim() };
}

function clampPositiveInt(n: number, max = 999): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.floor(n);
  if (v <= 0) return 0;
  return Math.min(v, max);
}

export function parseWhatsAppCommand(text: string): WhatsAppInboundCommand {
  const t = String(text || '').trim();
  if (!t) return { type: 'none' };

  const up = t.toUpperCase();
  // Accept: "ILIA HELP", "ILIA: HELP", "/help", etc.
  const withPrefix = up.replace(/^\s*@?ILIA\b[\s:,_-]*/i, '');

  // Pairing code: "PAIR ABCD1234EF56" (or "ILIA PAIR ...", "/pair ...")
  const pairMatch = withPrefix.match(/^(?:\/?PAIR|\/?EMPAREJAR|\/?VINCULAR)\s+([A-Z0-9]{4,12})$/i);
  if (pairMatch?.[1]) return { type: 'pair', code: pairMatch[1].toUpperCase() };

  if (/^(?:\/?HELP|\/?AYUDA)$/.test(withPrefix)) return { type: 'help' };
  if (/^(?:\/?STATUS|\/?ESTADO)$/.test(withPrefix)) return { type: 'status' };
  if (/^(?:\/?STOP|\/?DETENER|\/?PARAR|\/?PAUSA)$/.test(withPrefix)) return { type: 'stop' };
  if (/^(?:\/?START|\/?INICIAR|\/?CONTINUAR)$/.test(withPrefix)) return { type: 'start' };
  if (/^(?:\/?UNPAIR|\/?DESVINCULAR|\/?SALIR)$/.test(withPrefix)) return { type: 'unpair' };

  const chatsMatch = withPrefix.match(/^(?:\/?CHATS|\/?LIST|\/?LISTA)(?:\s+(\d{1,3}))?$/i);
  if (chatsMatch) {
    const limit = chatsMatch[1] ? clampPositiveInt(Number(chatsMatch[1]), 50) : undefined;
    return { type: 'chats', limit };
  }

  const openMatch = withPrefix.match(/^(?:\/?OPEN|\/?ABRIR|\/?VER)\s+(\d{1,3})$/i);
  if (openMatch?.[1]) return { type: 'open', index: clampPositiveInt(Number(openMatch[1]), 200) };

  const pinMatch = withPrefix.match(/^(?:\/?PIN|\/?FIJAR)\s+(\d{1,3})$/i);
  if (pinMatch?.[1]) return { type: 'pin', index: clampPositiveInt(Number(pinMatch[1]), 200) };

  const unpinMatch = withPrefix.match(/^(?:\/?UNPIN|\/?DESFIJAR)\s+(\d{1,3})$/i);
  if (unpinMatch?.[1]) return { type: 'unpin', index: clampPositiveInt(Number(unpinMatch[1]), 200) };

  const archiveMatch = withPrefix.match(/^(?:\/?ARCHIVE|\/?ARCHIVAR)\s+(\d{1,3})$/i);
  if (archiveMatch?.[1]) return { type: 'archive', index: clampPositiveInt(Number(archiveMatch[1]), 200) };

  const unarchiveMatch = withPrefix.match(/^(?:\/?UNARCHIVE|\/?DESARCHIVAR|\/?RESTORE|\/?RESTAURAR)\s+(\d{1,3})$/i);
  if (unarchiveMatch?.[1]) return { type: 'unarchive', index: clampPositiveInt(Number(unarchiveMatch[1]), 200) };

  return { type: 'none' };
}

