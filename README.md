# Tandem

Realtime collaborative markdown editor. Yjs CRDT + TipTap editor + Postgres persistence + Next.js app. Invite-only signup, owner/editor roles per document, optional public read-only links.

## Stack

- **Next.js 15** (App Router, TypeScript) + Tailwind + shadcn UI
- **Auth.js v5** Credentials provider, argon2id password hashing, JWT sessions
- **TipTap** with `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-cursor`
- **Yjs** + **y-websocket** standalone Node server (`server/ws.ts`)
- **Postgres** via `postgres` (porsager), all tables under `tandem` schema, raw SQL — no ORM

## Local setup

```bash
pnpm install
cp .env.example .env.local   # then edit DATABASE_URL, AUTH_SECRET, etc.
```

Apply the schema once:

```bash
psql "$DATABASE_URL" -f sql/001_schema.sql
```

Seed your first admin user. Generate a password hash first:

```bash
node -e "import('@node-rs/argon2').then(({hash})=>hash(process.argv[1]).then(console.log))" 'your-password-here'
```

Edit `sql/002_seed_admin.sql` with your email + hash, then:

```bash
psql "$DATABASE_URL" -f sql/002_seed_admin.sql
```

Run dev (Next + ws server together):

```bash
pnpm dev:all
```

- App: http://localhost:3000
- WS: ws://localhost:1234

Log in with the seeded admin, go to `/admin`, mint a signup token, share `/signup?token=...` with the next user.

## Production

1. Build:
   ```bash
   pnpm build         # Next.js
   pnpm build:ws      # compiles server/ws.ts to server/dist/server/ws.js
   ```
2. Set `NEXT_PUBLIC_WS_URL=wss://yourdomain/ws` in `.env.local`.
3. Drop `deploy/nginx.conf` snippet into your nginx config (TLS terminates there).
4. Install `deploy/tandem-web.service` and `deploy/tandem-ws.service` into `/etc/systemd/system/`, then:
   ```bash
   systemctl daemon-reload
   systemctl enable --now tandem-web tandem-ws
   ```

## How it fits together

- Client opens `/d/<docId>`, fetches `/api/ws-token?docId=...` which returns an HMAC-signed 60-second token (signed with `AUTH_SECRET`). The Next route checks `document_collaborators` first.
- Client connects to `wss://yourdomain/ws/<docId>?token=...`. The ws server verifies the HMAC, re-checks DB access, then joins the Yjs room.
- Every Yjs update is appended to `tandem.doc_updates`. Every 50 updates (or 5s of idle), the room compacts: `Y.encodeStateAsUpdate` → `doc_snapshots`, plus a rendered markdown copy for the public renderer. Old `doc_updates` rows ≤ the snapshot seq are deleted.
- Public read-only pages (`/p/<slug>`) just render the cached `markdown` column — no WS, no auth.

## Security notes

- Passwords hashed with argon2id (`@node-rs/argon2`), min 12 chars enforced at signup.
- Signup is invite-only; tokens are 24-byte url-safe random, single-use, optionally bound to an email.
- WS auth is a short-lived HMAC token, validated server-side, plus a fresh DB role check on every connect.
- Public links use 16-byte url-safe random slugs.
- All SQL is parameterized via the `postgres` tagged-template driver.
- Cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production.

## What's not in v1

- No password reset / email verification (no SMTP wired up).
- No version history (Yjs updates are compacted into the snapshot).
- No folders / tags — flat list.
- No public WS broadcasting; public viewers see the last snapshot, not live edits.
