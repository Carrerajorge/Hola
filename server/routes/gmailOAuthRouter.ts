import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { storage } from '../storage';
import crypto from 'crypto';

const router = Router();

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/userinfo.email'
];

const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

function getOAuth2Client() {
  const redirectUri = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/oauth/google/gmail/callback`
    : `${process.env.BASE_URL || 'http://localhost:5000'}/api/oauth/google/gmail/callback`;
    
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

router.get('/start', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, { 
    userId, 
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    state,
    prompt: 'consent'
  });

  res.json({ authUrl });
});

router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect('/?gmail_error=' + encodeURIComponent(String(error)));
    return;
  }

  if (!code || !state) {
    res.redirect('/?gmail_error=missing_params');
    return;
  }

  const pending = pendingStates.get(String(state));
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(String(state));
    res.redirect('/?gmail_error=invalid_state');
    return;
  }

  pendingStates.delete(String(state));

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(String(code));
    
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      res.redirect('/?gmail_error=no_email');
      return;
    }

    await storage.saveGmailOAuthToken({
      userId: pending.userId,
      accountEmail: email,
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: new Date(tokens.expiry_date!),
      scopes: GMAIL_SCOPES
    });

    console.log(`[Gmail OAuth] Successfully connected ${email} for user ${pending.userId}`);
    res.redirect('/?gmail_connected=true');
  } catch (error: any) {
    console.error('[Gmail OAuth] Callback error:', error);
    res.redirect('/?gmail_error=' + encodeURIComponent(error.message));
  }
});

router.get('/status', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  
  if (!userId) {
    res.json({ connected: false, useCustomOAuth: true });
    return;
  }

  try {
    const token = await storage.getGmailOAuthToken(userId);
    
    if (!token) {
      res.json({ connected: false, useCustomOAuth: true });
      return;
    }

    const gmail = google.gmail({ version: 'v1', auth: new google.auth.OAuth2() });
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken
    });
    
    const gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmailClient.users.labels.list({ userId: 'me' });

    res.json({
      connected: true,
      email: token.accountEmail,
      scopes: token.scopes,
      useCustomOAuth: true,
      hasFullPermissions: true
    });
  } catch (error: any) {
    console.error('[Gmail OAuth] Status check error:', error);
    res.json({ 
      connected: false, 
      error: error.message,
      useCustomOAuth: true 
    });
  }
});

router.post('/disconnect', async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const token = await storage.getGmailOAuthToken(userId);
    
    if (token) {
      try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: token.accessToken });
        await oauth2Client.revokeCredentials();
      } catch (e) {
        console.log('[Gmail OAuth] Token revocation failed (may already be revoked)');
      }
      
      await storage.deleteGmailOAuthToken(userId);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Gmail OAuth] Disconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

setInterval(() => {
  const now = Date.now();
  const entries = Array.from(pendingStates.entries());
  for (const [state, data] of entries) {
    if (data.expiresAt < now) {
      pendingStates.delete(state);
    }
  }
}, 60000);

export default router;
