CREATE TABLE sync_states (
  key_hash TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK (payload_version = 3),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
