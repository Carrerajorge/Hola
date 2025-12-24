import { 
  searchEmailsForUser, 
  checkGmailConnectionForUser,
  type EmailSummary 
} from './gmailService';
import { format, parseISO, isToday, isYesterday, isThisWeek, isThisMonth } from 'date-fns';
import { es } from 'date-fns/locale';

export interface GmailSearchRequest {
  query: string;
  maxResults?: number;
  pageToken?: string;
}

export interface FormattedEmailResult {
  markdown: string;
  emailCount: number;
  hasMore: boolean;
  nextPageToken?: string;
}

const EMAIL_PRIMARY_KEYWORDS = [
  'correo', 'correos', 'email', 'emails', 'mail', 'mails',
  'inbox', 'bandeja de entrada', 'bandeja',
  'gmail'
];

const EMAIL_ACTION_PATTERNS = [
  /(?:busca|buscar|muestra|mostrar|dame|ver|lista|listar)\s+(?:mis?\s+)?(?:correos?|emails?|mails?)/i,
  /(?:cuáles?|cuales?|qué|que)\s+(?:son\s+)?(?:mis?\s+)?(?:correos?|emails?)/i,
  /(?:correos?|emails?)\s+(?:de\s+)?(?:hoy|ayer|esta semana|este mes)/i,
  /(?:correos?|emails?)\s+(?:de|from)\s+\S+/i,
  /(?:correos?|emails?)\s+(?:no leídos?|sin leer|unread|importantes?|destacados?)/i,
  /(?:tengo|hay)\s+(?:correos?|emails?)\s+(?:nuevos?|sin leer)?/i,
  /mis\s+(?:correos?|emails?|mails?)/i
];

const TIME_FILTERS: Record<string, string> = {
  'hoy': 'newer_than:1d',
  'ayer': 'older_than:1d newer_than:2d',
  'esta semana': 'newer_than:7d',
  'este mes': 'newer_than:30d',
  'últimos 7 días': 'newer_than:7d',
  'últimos 30 días': 'newer_than:30d',
  'último mes': 'newer_than:30d',
  'semana pasada': 'older_than:7d newer_than:14d'
};

const SENDER_PATTERNS = [
  /de\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  /de\s+["']?([^"'\s,]+(?:\s+[^"'\s,]+)?)["']?/i,
  /from\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  /from\s+["']?([^"'\s,]+)["']?/i
];

export function detectEmailIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  const hasPrimaryKeyword = EMAIL_PRIMARY_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
  
  if (hasPrimaryKeyword) {
    return true;
  }
  
  return EMAIL_ACTION_PATTERNS.some(pattern => pattern.test(message));
}

export function extractGmailQuery(message: string): string {
  const lowerMessage = message.toLowerCase();
  let query = '';
  
  for (const [phrase, gmailFilter] of Object.entries(TIME_FILTERS)) {
    if (lowerMessage.includes(phrase)) {
      query += ` ${gmailFilter}`;
      break;
    }
  }
  
  for (const pattern of SENDER_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1]) {
      query += ` from:${match[1]}`;
      break;
    }
  }
  
  if (lowerMessage.includes('no leído') || lowerMessage.includes('no leídos') || 
      lowerMessage.includes('sin leer') || lowerMessage.includes('unread')) {
    query += ' is:unread';
  }
  
  if (lowerMessage.includes('importante') || lowerMessage.includes('important')) {
    query += ' is:important';
  }
  
  if (lowerMessage.includes('destacado') || lowerMessage.includes('starred')) {
    query += ' is:starred';
  }
  
  const subjectMatch = message.match(/(?:sobre|asunto|subject|con\s+asunto)\s+["']?([^"'\n]+)["']?/i);
  if (subjectMatch && subjectMatch[1]) {
    query += ` subject:${subjectMatch[1].trim()}`;
  }
  
  return query.trim() || 'in:inbox';
}

function formatEmailDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      return `Ayer ${format(date, 'HH:mm')}`;
    } else if (isThisWeek(date)) {
      return format(date, 'EEE HH:mm', { locale: es });
    } else if (isThisMonth(date)) {
      return format(date, 'd MMM HH:mm', { locale: es });
    } else {
      return format(date, 'd MMM yyyy', { locale: es });
    }
  } catch {
    return dateStr;
  }
}

function formatLabels(labels: string[]): string {
  const visibleLabels = labels.filter(label => 
    !['CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_PERSONAL', 'CATEGORY_FORUMS'].includes(label) ||
    labels.includes('UNREAD') || labels.includes('IMPORTANT') || labels.includes('STARRED')
  );
  
  const labelMap: Record<string, string> = {
    'UNREAD': 'UNREAD',
    'INBOX': 'INBOX',
    'IMPORTANT': 'IMPORTANT',
    'STARRED': 'STARRED',
    'SENT': 'SENT',
    'DRAFT': 'DRAFT',
    'SPAM': 'SPAM',
    'TRASH': 'TRASH',
    'CATEGORY_UPDATES': 'CATEGORY_UPDATES',
    'CATEGORY_PROMOTIONS': 'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL': 'CATEGORY_SOCIAL',
    'CATEGORY_PERSONAL': 'CATEGORY_PERSONAL',
    'CATEGORY_FORUMS': 'CATEGORY_FORUMS'
  };
  
  return visibleLabels
    .slice(0, 3)
    .map(label => `\`${labelMap[label] || label}\``)
    .join(', ');
}

function getFaviconDomain(email: string): string {
  try {
    const domain = email.split('@')[1];
    return domain || '';
  } catch {
    return '';
  }
}

export function formatEmailsAsMarkdown(emails: EmailSummary[], startIndex: number = 1): string {
  if (emails.length === 0) {
    return 'No se encontraron correos que coincidan con tu búsqueda.';
  }
  
  const formattedEmails = emails.map((email, index) => {
    const num = startIndex + index;
    const senderName = email.from || 'Sin remitente';
    const senderEmail = email.fromEmail || '';
    const subject = email.subject || '(Sin asunto)';
    const time = formatEmailDate(email.date);
    const labels = formatLabels(email.labels);
    const snippet = email.snippet ? email.snippet.slice(0, 80) + (email.snippet.length > 80 ? '...' : '') : '';
    const domain = getFaviconDomain(senderEmail);
    
    const emailLink = senderEmail ? `[${senderEmail}](mailto:${senderEmail}) ↗` : '';
    
    let line = `${num}. **${senderName}** ${emailLink} — *${subject}* · ${time}`;
    
    if (labels) {
      line += ` · [${labels}]`;
    }
    
    line += `.`;
    
    if (snippet) {
      const domainTag = domain ? `📧 ${domain} ` : '📧 ';
      line += `\n   ${domainTag}${snippet}`;
    }
    
    return line;
  }).join('\n\n');
  
  return formattedEmails;
}

export async function searchAndFormatEmails(
  userId: string,
  userMessage: string,
  maxResults: number = 500
): Promise<FormattedEmailResult | null> {
  try {
    const connection = await checkGmailConnectionForUser(userId);
    if (!connection.connected) {
      return null;
    }
    
    const gmailQuery = extractGmailQuery(userMessage);
    console.log(`[Gmail Chat] User query: "${userMessage}" -> Gmail query: "${gmailQuery}"`);
    
    const allEmails: EmailSummary[] = [];
    let pageToken: string | undefined = undefined;
    let totalFetched = 0;
    const batchSize = 50;
    
    while (totalFetched < maxResults) {
      const remaining = maxResults - totalFetched;
      const fetchCount = Math.min(batchSize, remaining);
      
      const result = await searchEmailsForUser(
        userId,
        gmailQuery,
        fetchCount,
        undefined,
        pageToken
      );
      
      allEmails.push(...result.emails);
      totalFetched += result.emails.length;
      
      if (!result.nextPageToken || result.emails.length < fetchCount) {
        pageToken = undefined;
        break;
      }
      
      pageToken = result.nextPageToken;
    }
    
    if (allEmails.length === 0) {
      return {
        markdown: `No encontré correos que coincidan con "${userMessage}".\n\nPuedes intentar con:\n- "correos de hoy"\n- "correos de [remitente]"\n- "correos no leídos"\n- "correos importantes"`,
        emailCount: 0,
        hasMore: false
      };
    }
    
    const markdown = formatEmailsAsMarkdown(allEmails);
    
    const header = `📬 **Encontré ${allEmails.length} correo${allEmails.length !== 1 ? 's' : ''}**\n\n`;
    
    const footer = `\n\n---\n\nSi quieres puedo:\n- **Mostrar más** (siguientes correos)\n- **Filtrar** solo los no leídos\n- **Abrir/leer** cualquiera de los correos listados (dime el número)\n\n¿Qué prefieres?`;
    
    return {
      markdown: header + markdown + footer,
      emailCount: allEmails.length,
      hasMore: !!pageToken,
      nextPageToken: pageToken
    };
    
  } catch (error: any) {
    console.error('[Gmail Chat] Error searching emails:', error);
    
    if (error.message?.includes('Gmail not connected')) {
      return {
        markdown: '❌ Gmail no está conectado. Por favor, conecta tu cuenta de Gmail desde la configuración de integraciones.',
        emailCount: 0,
        hasMore: false
      };
    }
    
    if (error.message?.includes('token expired') || error.message?.includes('reconnect')) {
      return {
        markdown: '⚠️ Tu sesión de Gmail ha expirado. Por favor, reconecta tu cuenta de Gmail.',
        emailCount: 0,
        hasMore: false
      };
    }
    
    return {
      markdown: `❌ Error al buscar correos: ${error.message}`,
      emailCount: 0,
      hasMore: false
    };
  }
}

export async function handleEmailChatRequest(
  userId: string,
  userMessage: string
): Promise<{ handled: boolean; response?: string }> {
  if (!detectEmailIntent(userMessage)) {
    return { handled: false };
  }
  
  const result = await searchAndFormatEmails(userId, userMessage);
  
  if (!result) {
    return { 
      handled: true, 
      response: '📧 Para buscar tus correos, primero necesitas conectar tu cuenta de Gmail. Ve a la sección de integraciones para configurarlo.' 
    };
  }
  
  return {
    handled: true,
    response: result.markdown
  };
}
