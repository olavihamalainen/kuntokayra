CREATE TABLE google_test_sessions (
    token_hash TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX google_test_sessions_expiration ON google_test_sessions (expires_at);
