CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
