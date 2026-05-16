import { NextResponse } from "next/server";
import { hash } from "@node-rs/argon2";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const token = String(body.token ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const displayName = String(body.displayName ?? "").trim();
  const password = String(body.password ?? "");
  if (!token || !email || !displayName || password.length < 12) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  // Validate token
  const [tok] = await sql<{ token: string; email: string | null; doc_invite_id: string | null; expires_at: Date; used_at: Date | null }[]>`
    SELECT token, email, doc_invite_id, expires_at, used_at
    FROM tandem.signup_tokens WHERE token = ${token} LIMIT 1`;
  if (!tok) return NextResponse.json({ error: "Invalid invite token" }, { status: 400 });
  if (tok.used_at) return NextResponse.json({ error: "Invite token already used" }, { status: 400 });
  if (new Date(tok.expires_at).getTime() < Date.now()) return NextResponse.json({ error: "Invite token expired" }, { status: 400 });
  if (tok.email && tok.email.toLowerCase() !== email) {
    return NextResponse.json({ error: "Token is bound to a different email" }, { status: 400 });
  }

  // Existing email?
  const [existing] = await sql`SELECT 1 FROM tandem.users WHERE email = ${email} LIMIT 1`;
  if (existing) return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });

  const password_hash = await hash(password);

  // Create user, mark token used, attach any pending doc invites for this email, all in one tx
  const userId = await sql.begin(async (tx) => {
    const [u] = await tx<{ id: string }[]>`
      INSERT INTO tandem.users (email, display_name, password_hash)
      VALUES (${email}, ${displayName}, ${password_hash})
      RETURNING id`;
    await tx`UPDATE tandem.signup_tokens SET used_at = now(), used_by = ${u.id} WHERE token = ${token}`;

    // If token was bound to a doc invite, accept it now
    if (tok.doc_invite_id) {
      const [inv] = await tx<{ document_id: string; role: string }[]>`
        SELECT document_id, role FROM tandem.document_invites WHERE id = ${tok.doc_invite_id} AND accepted_at IS NULL`;
      if (inv) {
        await tx`INSERT INTO tandem.document_collaborators (document_id, user_id, role)
                 VALUES (${inv.document_id}, ${u.id}, ${inv.role})
                 ON CONFLICT DO NOTHING`;
        await tx`UPDATE tandem.document_invites SET accepted_at = now() WHERE id = ${tok.doc_invite_id}`;
      }
    }

    // Also auto-resolve any other pending invites that match this email
    const pending = await tx<{ id: string; document_id: string; role: string }[]>`
      SELECT id, document_id, role FROM tandem.document_invites
      WHERE email = ${email} AND accepted_at IS NULL`;
    for (const p of pending) {
      await tx`INSERT INTO tandem.document_collaborators (document_id, user_id, role)
               VALUES (${p.document_id}, ${u.id}, ${p.role})
               ON CONFLICT DO NOTHING`;
      await tx`UPDATE tandem.document_invites SET accepted_at = now() WHERE id = ${p.id}`;
    }

    return u.id;
  });

  return NextResponse.json({ ok: true, userId });
}
