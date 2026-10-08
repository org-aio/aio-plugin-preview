CREATE TABLE preview_history (
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    mime text NOT NULL,
    content bytea NOT NULL CHECK (length(content) <= 4194304),
    opened_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, id)
);
CREATE INDEX preview_history_owner_time ON preview_history (tenant_id, user_id, opened_at DESC);
CREATE INDEX preview_history_expiry ON preview_history (opened_at);
