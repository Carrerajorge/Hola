export interface RichTextToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
  isMath?: boolean;
}

interface TokenPattern {
  regex: RegExp;
  handler: (match: RegExpExecArray) => RichTextToken;
}

const patterns: TokenPattern[] = [
  {
    regex: /\$\$(.+?)\$\$/,
    handler: (match) => ({ text: match[1], isMath: true }),
  },
  {
    regex: /\$(.+?)\$/,
    handler: (match) => ({ text: match[1], isMath: true }),
  },
  {
    regex: /\*\*\*(.+?)\*\*\*/,
    handler: (match) => ({ text: match[1], bold: true, italic: true }),
  },
  {
    regex: /\*\*(.+?)\*\*/,
    handler: (match) => ({ text: match[1], bold: true }),
  },
  {
    regex: /\*(.+?)\*/,
    handler: (match) => ({ text: match[1], italic: true }),
  },
  {
    regex: /__(.+?)__/,
    handler: (match) => ({ text: match[1], bold: true }),
  },
  {
    regex: /_(.+?)_/,
    handler: (match) => ({ text: match[1], italic: true }),
  },
  {
    regex: /`(.+?)`/,
    handler: (match) => ({ text: match[1], code: true }),
  },
  {
    regex: /\[([^\]]+)\]\(([^)]+)\)/,
    handler: (match) => ({ text: match[1], link: match[2] }),
  },
];

export function tokenizeMarkdown(text: string): RichTextToken[] {
  if (!text || typeof text !== "string") {
    return text ? [{ text: String(text) }] : [];
  }

  const tokens: RichTextToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliestMatch: { index: number; pattern: TokenPattern; match: RegExpExecArray } | null = null;

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch === null) {
      if (remaining.length > 0) {
        tokens.push({ text: remaining });
      }
      break;
    }

    if (earliestMatch.index > 0) {
      tokens.push({ text: remaining.slice(0, earliestMatch.index) });
    }

    tokens.push(earliestMatch.pattern.handler(earliestMatch.match));
    remaining = remaining.slice(earliestMatch.index + earliestMatch.match[0].length);
  }

  return tokens.filter((t) => t.text.length > 0);
}

export function hasMarkdown(text: string): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }
  return patterns.some((p) => {
    p.regex.lastIndex = 0;
    return p.regex.test(text);
  });
}
