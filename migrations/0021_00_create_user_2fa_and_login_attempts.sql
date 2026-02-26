
-- =============================================================================

-- Migration 0021_00: Create user_2fa + login_attempts (required by admin_user_projection + 2FA service)

-- =============================================================================



CREATE TABLE IF NOT EXISTS user_2fa (

  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255) UNIQUE NOT NULL,

  secret VARCHAR(255) NOT NULL,

  is_enabled BOOLEAN DEFAULT false,

  backup_codes JSONB DEFAULT '[]',

  verified_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),

  updated_at TIMESTAMP DEFAULT NOW()

);



CREATE TABLE IF NOT EXISTS login_attempts (

  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id VARCHAR(255),

  email VARCHAR(255),

  ip_address VARCHAR(45),

  user_agent TEXT,

  success BOOLEAN,

  failure_reason VARCHAR(100),

  created_at TIMESTAMP DEFAULT NOW()

);



CREATE INDEX IF NOT EXISTS idx_2fa_user ON user_2fa(user_id);

CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_id);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);

