CREATE TABLE google_browser_grants (
    grant_hash TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    frontend_url TEXT NOT NULL,
    account TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX google_browser_grants_expiration ON google_browser_grants (expires_at);
