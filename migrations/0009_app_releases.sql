
CREATE EXTENSION IF NOT EXISTS pgcrypto;



CREATE TABLE IF NOT EXISTS app_releases (

  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  platform text NOT NULL,

  version text NOT NULL,

  size bigint,

  requirements jsonb,

  available boolean NOT NULL DEFAULT true,

  file_name text,

  download_url text,

  note text,

  is_active boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now()

);



CREATE INDEX IF NOT EXISTS idx_app_releases_is_active_created_at

  ON app_releases (is_active, created_at DESC);

