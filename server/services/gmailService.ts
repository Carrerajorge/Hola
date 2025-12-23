// Gmail Service - Replit Gmail Integration
// Uses Replit Connectors for OAuth token management

import { google, gmail_v1 } from 'googleapis';

let connectionSettings: any;

async function getAccessToken(): Promise<string> {
  if (connectionSettings && connectionSettings.settings?.expires_at && 
      new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );

  const data = await response.json();
  connectionSettings = data.items?.[0];

  const accessToken = connectionSettings?.settings?.access_token || 
                      connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client - access tokens expire
async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface GmailConnectionStatus {
  connected: boolean;
  email?: string;
  displayName?: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
}

export interface EmailThread {
  id: string;
  subject: string;
  messages: EmailMessage[];
  labels: string[];
}

export interface EmailMessage {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  date: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  snippet: string;
}

export async function checkGmailConnection(): Promise<GmailConnectionStatus> {
  try {
    const gmail = await getGmailClient();
    // Use labels.list instead of getProfile since we have gmail.labels scope
    const labels = await gmail.users.labels.list({ userId: 'me' });
    
    if (labels.data.labels && labels.data.labels.length > 0) {
      return {
        connected: true
      };
    }
    return { connected: false };
  } catch (error: any) {
    console.log("[Gmail] Connection check failed:", error.message);
    return { connected: false };
  }
}

function parseEmailAddress(header: string): { name: string; email: string } {
  const match = header.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
  if (match) {
    return { name: match[1] || match[2], email: match[2] };
  }
  return { name: header, email: header };
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  if (!payload) return { text: '', html: '' };

  let text = '';
  let html = '';

  if (payload.body?.data) {
    const decoded = decodeBase64(payload.body.data);
    if (payload.mimeType === 'text/plain') {
      text = decoded;
    } else if (payload.mimeType === 'text/html') {
      html = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const extracted = extractBody(part);
      if (extracted.text) text = extracted.text;
      if (extracted.html) html = extracted.html;
    }
  }

  return { text, html };
}

export async function searchEmails(
  query: string = '',
  maxResults: number = 20,
  labelIds?: string[]
): Promise<EmailSummary[]> {
  const gmail = await getGmailClient();
  
  const listParams: gmail_v1.Params$Resource$Users$Messages$List = {
    userId: 'me',
    maxResults,
    q: query || undefined,
    labelIds: labelIds
  };

  const response = await gmail.users.messages.list(listParams);
  const messages = response.data.messages || [];

  const emailSummaries: EmailSummary[] = [];

  for (const msg of messages.slice(0, maxResults)) {
    try {
      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      });

      const headers = fullMsg.data.payload?.headers;
      const fromHeader = getHeader(headers, 'From');
      const fromParsed = parseEmailAddress(fromHeader);
      const labels = fullMsg.data.labelIds || [];

      emailSummaries.push({
        id: msg.id!,
        threadId: msg.threadId || msg.id!,
        subject: getHeader(headers, 'Subject') || '(Sin asunto)',
        from: fromParsed.name,
        fromEmail: fromParsed.email,
        to: getHeader(headers, 'To'),
        date: getHeader(headers, 'Date'),
        snippet: fullMsg.data.snippet || '',
        labels,
        isUnread: labels.includes('UNREAD')
      });
    } catch (error) {
      console.error(`[Gmail] Error fetching message ${msg.id}:`, error);
    }
  }

  return emailSummaries;
}

export async function getEmailThread(threadId: string): Promise<EmailThread | null> {
  try {
    const gmail = await getGmailClient();
    
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const messages: EmailMessage[] = [];
    let threadSubject = '';
    const threadLabels = new Set<string>();

    for (const msg of thread.data.messages || []) {
      const headers = msg.payload?.headers;
      const fromHeader = getHeader(headers, 'From');
      const fromParsed = parseEmailAddress(fromHeader);
      const subject = getHeader(headers, 'Subject');
      
      if (!threadSubject) threadSubject = subject;
      
      (msg.labelIds || []).forEach(l => threadLabels.add(l));
      
      const body = extractBody(msg.payload);

      messages.push({
        id: msg.id!,
        from: fromParsed.name,
        fromEmail: fromParsed.email,
        to: getHeader(headers, 'To'),
        date: getHeader(headers, 'Date'),
        subject,
        body: body.text || body.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        bodyHtml: body.html || undefined,
        snippet: msg.snippet || ''
      });
    }

    return {
      id: threadId,
      subject: threadSubject || '(Sin asunto)',
      messages,
      labels: Array.from(threadLabels)
    };
  } catch (error: any) {
    console.error(`[Gmail] Error fetching thread ${threadId}:`, error);
    return null;
  }
}

export async function sendReply(
  threadId: string,
  to: string,
  subject: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmail = await getGmailClient();
    
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const from = profile.data.emailAddress;

    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    
    const emailLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${replySubject}`,
      `Content-Type: text/plain; charset=utf-8`,
      '',
      body
    ];

    const rawMessage = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawMessage,
        threadId
      }
    });

    return { success: true, messageId: response.data.id || undefined };
  } catch (error: any) {
    console.error('[Gmail] Error sending reply:', error);
    return { success: false, error: error.message };
  }
}

export async function getLabels(): Promise<Array<{ id: string; name: string; type: string }>> {
  try {
    const gmail = await getGmailClient();
    const response = await gmail.users.labels.list({ userId: 'me' });
    
    return (response.data.labels || []).map(label => ({
      id: label.id!,
      name: label.name!,
      type: label.type || 'user'
    }));
  } catch (error: any) {
    console.error('[Gmail] Error fetching labels:', error);
    return [];
  }
}

export async function markAsRead(messageId: string): Promise<boolean> {
  try {
    const gmail = await getGmailClient();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD']
      }
    });
    return true;
  } catch (error: any) {
    console.error('[Gmail] Error marking as read:', error);
    return false;
  }
}

export async function markAsUnread(messageId: string): Promise<boolean> {
  try {
    const gmail = await getGmailClient();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: ['UNREAD']
      }
    });
    return true;
  } catch (error: any) {
    console.error('[Gmail] Error marking as unread:', error);
    return false;
  }
}
