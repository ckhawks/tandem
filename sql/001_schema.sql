-- Tandem — schema bootstrap. Run once against your existing Postgres DB.
-- All tables live in the `tandem` schema so they don't collide with anything else.

CREATE SCHEMA IF NOT EXISTS tandem;
SET search_path TO tandem, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- =============== users ===============
CREATE TABLE IF NOT EXISTS tandem.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE NOT NULL,
  display_name    text   NOT NULL,
  password_hash   text   NOT NULL,
  is_admin        boolean NOT NULL DEFAULT false,
  color           text   NOT NULL DEFAULT '#'||substr(md5(random()::text),1,6),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- =============== sessions (Auth.js) ===============
CREATE TABLE IF NOT EXISTS tandem.sessions (
  session_token   text   PRIMARY KEY,
  user_id         uuid   NOT NULL REFERENCES tandem.users(id) ON DELETE CASCADE,
  expires         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON tandem.sessions(user_id);

-- =============== documents ===============
CREATE TABLE IF NOT EXISTS tandem.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES tandem.users(id) ON DELETE RESTRICT,
  title           text NOT NULL DEFAULT 'Untitled',
  public_slug     text UNIQUE,
  is_public       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON tandem.documents(owner_id);

-- =============== collaborators ===============
CREATE TABLE IF NOT EXISTS tandem.document_collaborators (
  document_id     uuid NOT NULL REFERENCES tandem.documents(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES tandem.users(id)     ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('owner','editor')),
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS doc_collab_user_idx ON tandem.document_collaborators(user_id);

-- =============== pending invites (resolve at signup or login) ===============
CREATE TABLE IF NOT EXISTS tandem.document_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES tandem.documents(id) ON DELETE CASCADE,
  email           citext NOT NULL,
  role            text NOT NULL CHECK (role IN ('editor')),
  invited_by      uuid NOT NULL REFERENCES tandem.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  UNIQUE (document_id, email)
);
CREATE INDEX IF NOT EXISTS doc_invites_email_idx ON tandem.document_invites(email) WHERE accepted_at IS NULL;

-- =============== signup tokens (invite-only signup) ===============
CREATE TABLE IF NOT EXISTS tandem.signup_tokens (
  token           text PRIMARY KEY,
  email           citext,                            -- optional: bind token to email
  doc_invite_id   uuid REFERENCES tandem.document_invites(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES tandem.users(id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  used_by         uuid REFERENCES tandem.users(id) ON DELETE SET NULL
);

-- =============== Yjs document state ===============
-- Append-only stream of binary updates. Server compacts these into a snapshot periodically.
CREATE TABLE IF NOT EXISTS tandem.doc_updates (
  document_id     uuid NOT NULL REFERENCES tandem.documents(id) ON DELETE CASCADE,
  seq             bigserial,
  update          bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, seq)
);

CREATE TABLE IF NOT EXISTS tandem.doc_snapshots (
  document_id     uuid PRIMARY KEY REFERENCES tandem.documents(id) ON DELETE CASCADE,
  snapshot        bytea NOT NULL,
  up_to_seq       bigint NOT NULL,
  markdown        text NOT NULL DEFAULT '',  -- cached markdown for public renderer
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Convenience trigger: bump documents.updated_at on snapshot writes
CREATE OR REPLACE FUNCTION tandem.touch_document() RETURNS trigger AS $$
BEGIN
  UPDATE tandem.documents SET updated_at = now() WHERE id = NEW.document_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS doc_snapshot_touch ON tandem.doc_snapshots;
CREATE TRIGGER doc_snapshot_touch
  AFTER INSERT OR UPDATE ON tandem.doc_snapshots
  FOR EACH ROW EXECUTE FUNCTION tandem.touch_document();
