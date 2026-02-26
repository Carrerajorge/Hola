// server/openclaw/memory/queryExpansion.ts

const EN_STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can','could',
  'i','me','my','we','our','you','your','he','him','his','she','her','it','its','they','them','their',
  'this','that','these','those','what','which','who','whom','where','when','why','how',
  'of','in','on','at','to','for','with','from','by','about','into','through','during','before','after',
  'above','below','between','under','over','up','down','out','off','then','than','so','if','or','and',
  'but','not','no','nor','all','each','every','both','few','more','most','other','some','such','only',
]);

const ES_STOP_WORDS = new Set([
  'el','la','los','las','un','una','unos','unas','de','del','al','a','en','con','por','para',
  'sin','sobre','entre','como','pero','mas','se','su','sus','este','esta','estos','estas',
  'ese','esa','esos','esas','que','y','o','ni','es','son','fue','ser','estar','hay','tiene',
]);

const ALL_STOP_WORDS = new Set([...EN_STOP_WORDS, ...ES_STOP_WORDS]);

export function extractKeywords(query: string): string[] {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue;
    if (ALL_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }

  return keywords;
}

export function buildFtsQuery(raw: string): string | null {
  const tokens = raw.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map(t => `"${t}"`).join(' AND ');
}
