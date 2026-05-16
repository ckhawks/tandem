# Deploying Tandem on a VPS at /root/tandem

Target: `tandem.stlr.cx`, nginx terminates TLS, Next.js + y-websocket run as root via systemd.

## 1. Get the code on the box

```bash
cd /root
git clone https://github.com/ckhawks/tandem.git
cd /root/tandem
```

Install pnpm if you don't have it:

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc
```

Install deps and build both targets:

```bash
pnpm install
pnpm build         # Next.js production build
pnpm build:ws      # compiles server/ws.ts -> server/dist/server/ws.js
```

## 2. Create `.env`

```bash
cp deploy/env.production.example .env
chmod 600 .env
$EDITOR .env       # set DATABASE_URL, AUTH_SECRET (openssl rand -base64 32)
```

## 3. Apply the schema (once)

Either run `sql/001_schema.sql` via psql against `$DATABASE_URL`, or use the
`postgres` driver from inside the project:

```bash
node -e "import('postgres').then(async({default:p})=>{const sql=p(process.env.DATABASE_URL,{onnotice:()=>{}});const fs=require('fs');await sql.unsafe(fs.readFileSync('sql/001_schema.sql','utf8'));await sql.end()})" 
```

Seed the first admin (edit `sql/002_seed_admin.sql` with your email and an
argon2id hash first):

```bash
# Generate a hash:
node -e "import('@node-rs/argon2').then(({hash})=>hash(process.argv[1]).then(console.log))" 'your-password'
# Paste the hash + your email into sql/002_seed_admin.sql, then:
node -e "import('postgres').then(async({default:p})=>{const sql=p(process.env.DATABASE_URL,{onnotice:()=>{}});const fs=require('fs');await sql.unsafe(fs.readFileSync('sql/002_seed_admin.sql','utf8'));await sql.end()})"
```

## 4. Install systemd units

```bash
cp deploy/tandem-web.service /etc/systemd/system/
cp deploy/tandem-ws.service  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tandem-web tandem-ws
systemctl status tandem-web tandem-ws
journalctl -u tandem-web -u tandem-ws -f          # tail logs
```

## 5. nginx + TLS

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/tandem.stlr.cx.conf
ln -sf /etc/nginx/sites-available/tandem.stlr.cx.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Issue the cert (this also rewrites the :80 block to redirect to :443):
certbot --nginx -d tandem.stlr.cx
```

## 6. Verify

- `https://tandem.stlr.cx/login` loads.
- Sign in with your seeded admin.
- Open a doc — status indicator should go `connecting → online`.
- Open a second browser, edit — peers' cursors appear, edits sync.
- Reload either browser — content persists.

## Updating

```bash
cd /root/tandem
git pull
pnpm install
pnpm build && pnpm build:ws
systemctl restart tandem-web tandem-ws
```

## Common issues

- **`wss://` connection fails**: confirm `NEXT_PUBLIC_WS_URL=wss://tandem.stlr.cx/ws` (with `/ws`, no trailing slash) and the nginx `location /ws/` block exists. The `WebsocketProvider` appends `/<docId>?token=...` to that URL.
- **Login fails with valid credentials**: check `journalctl -u tandem-web -n 200` for `[auth][error]`. Most often the seeded email has a typo.
- **Editor connects but content empty on reload**: snapshot persistence requires the `tandem.touch_document()` function to exist with `tandem.*` table refs. Verify with `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='touch_document';`.
- **`__Secure-` cookie not set**: that cookie prefix only works over HTTPS. If you're testing on plain HTTP behind a tunnel, drop `__Secure-` from `AUTH_COOKIE_NAME`.
