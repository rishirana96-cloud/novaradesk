CREATE TABLE IF NOT EXISTS app_users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, google_sub TEXT UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('admin','agent')), status TEXT NOT NULL CHECK(status IN ('active','blocked')),
 workspace_id TEXT NOT NULL, UNIQUE(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS app_sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_challenges (nonce_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS tickets_workspace ON tickets(workspace_id,id);
CREATE TABLE IF NOT EXISTS handoff_codes (
 code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id),
 shop TEXT NOT NULL, expires_at INTEGER NOT NULL
);
