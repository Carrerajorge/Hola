-- Add provider_hint column to oauth_states for Gemini/OpenAI auto-connect after login
ALTER TABLE "oauth_states" ADD COLUMN IF NOT EXISTS "provider_hint" varchar(50);
