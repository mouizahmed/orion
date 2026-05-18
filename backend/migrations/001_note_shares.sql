-- Migration: note_shares table
-- Idempotent: uses IF NOT EXISTS guards throughout

CREATE TABLE IF NOT EXISTS note_shares (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id    UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  shared_by  UUID        NOT NULL REFERENCES users(id),
  email      TEXT        NOT NULL,
  user_id    UUID        REFERENCES users(id),
  role       TEXT        NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (note_id, email)
);

CREATE INDEX IF NOT EXISTS note_shares_note_id_idx ON note_shares(note_id);
