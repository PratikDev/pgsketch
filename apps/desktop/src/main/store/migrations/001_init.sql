CREATE TABLE connections (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,           -- params | url | socket
  host          TEXT,
  port          INTEGER,
  user_name     TEXT,
  database      TEXT NOT NULL,
  url           TEXT,                    -- url kind only, password removed
  ssl_mode      TEXT NOT NULL,           -- disable | prefer | require | verify-full
  ssl_ca_path   TEXT,                    -- verify-full only
  password_enc  BLOB,                    -- safeStorage ciphertext, null if none
  last_used_at  INTEGER NOT NULL
);

CREATE TABLE drafts (
  db_key        TEXT PRIMARY KEY,
  fingerprint   TEXT NOT NULL,           -- baseline fingerprint the draft was made on
  desired_json  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE layouts (
  db_key        TEXT NOT NULL,
  object_id     TEXT NOT NULL,           -- table id
  x REAL NOT NULL, y REAL NOT NULL,
  PRIMARY KEY (db_key, object_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- JSON
);
