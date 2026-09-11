CREATE TABLE sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  payload TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK (payload_version = 3),
  saved_at TEXT NOT NULL,
  FOREIGN KEY (key_hash) REFERENCES sync_states(key_hash) ON DELETE CASCADE
);

CREATE INDEX sync_history_key_hash_id ON sync_history (key_hash, id DESC);
