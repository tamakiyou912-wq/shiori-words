CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('OWNER', 'USER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'USER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_unique ON users(role) WHERE role = 'OWNER';

CREATE TABLE IF NOT EXISTS site_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  registration_mode text NOT NULL DEFAULT 'invite' CHECK (registration_mode IN ('open', 'invite', 'closed')),
  max_users integer NOT NULL DEFAULT 20 CHECK (max_users BETWEEN 1 AND 10000),
  site_name text NOT NULL DEFAULT '詞織 / SHIORI',
  allow_guest_codes boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS registration_invites (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 10000),
  used_uses integer NOT NULL DEFAULT 0 CHECK (used_uses >= 0 AND used_uses <= max_uses),
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registration_invites_created_by_idx ON registration_invites(created_by_user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_credentials (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  base_url text NOT NULL,
  model text NOT NULL,
  encrypted_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_codes (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text,
  max_uses integer NOT NULL DEFAULT 20 CHECK (max_uses > 0 AND max_uses <= 10000),
  used_uses integer NOT NULL DEFAULT 0 CHECK (used_uses >= 0),
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_codes_owner_idx ON guest_codes(owner_user_id);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id text PRIMARY KEY,
  code_id text NOT NULL REFERENCES guest_codes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_sessions_code_idx ON guest_sessions(code_id);
CREATE INDEX IF NOT EXISTS guest_sessions_expiry_idx ON guest_sessions(expires_at);

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  guest_session_id text REFERENCES guest_sessions(id) ON DELETE CASCADE,
  context jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK ((user_id IS NOT NULL) <> (guest_session_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id);
CREATE INDEX IF NOT EXISTS conversations_guest_idx ON conversations(guest_session_id);

CREATE TABLE IF NOT EXISTS translation_history (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  input text NOT NULL,
  summary text NOT NULL,
  detected_language text NOT NULL,
  target_language text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS translation_history_user_created_idx ON translation_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
);
