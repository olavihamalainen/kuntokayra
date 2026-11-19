CREATE TABLE IF NOT EXISTS journal_sync_commits (
    revision INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    changes TEXT NOT NULL CHECK (json_valid(changes))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS journal_sync_account_revision ON journal_sync_commits (account, revision);
