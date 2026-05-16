import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getDocAccess } from "@/lib/access";

async function requireOwner(docId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await getDocAccess(docId, session.user.id);
  if (!access || access.role !== "owner") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireOwner(id);
  if ("error" in r) return r.error;

  const [collaborators, invites, meta] = await Promise.all([
    sql<{ user_id: string; email: string; display_name: string; role: "owner" | "editor" }[]>`
      SELECT c.user_id, u.email::text AS email, u.display_name, c.role
      FROM tandem.document_collaborators c
      JOIN tandem.users u ON u.id = c.user_id
      WHERE c.document_id = ${id}
      ORDER BY c.role DESC, u.display_name ASC`,
    sql<{ id: string; email: string }[]>`
      SELECT id, email::text AS email FROM tandem.document_invites
      WHERE document_id = ${id} AND accepted_at IS NULL ORDER BY created_at DESC`,
    sql<{ is_public: boolean; public_slug: string | null }[]>`
      SELECT is_public, public_slug FROM tandem.documents WHERE id = ${id} LIMIT 1`,
  ]);
  return NextResponse.json({
    collaborators,
    invites,
    isPublic: meta[0]?.is_public ?? false,
    publicSlug: meta[0]?.public_slug ?? null,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireOwner(id);
  if ("error" in r) return r.error;
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // If user exists, add directly as collaborator. Else create pending invite.
  const [user] = await sql<{ id: string }[]>`SELECT id FROM tandem.users WHERE email = ${email} LIMIT 1`;
  if (user) {
    await sql`INSERT INTO tandem.document_collaborators (document_id, user_id, role)
              VALUES (${id}, ${user.id}, 'editor')
              ON CONFLICT DO NOTHING`;
    return NextResponse.json({ ok: true, added: true });
  }
  await sql`INSERT INTO tandem.document_invites (document_id, email, role, invited_by)
            VALUES (${id}, ${email}, 'editor', ${r.session!.user.id})
            ON CONFLICT (document_id, email) DO NOTHING`;
  return NextResponse.json({ ok: true, added: false });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireOwner(id);
  if ("error" in r) return r.error;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const inviteId = url.searchParams.get("inviteId");
  if (userId) {
    await sql`DELETE FROM tandem.document_collaborators
              WHERE document_id = ${id} AND user_id = ${userId} AND role <> 'owner'`;
    return NextResponse.json({ ok: true });
  }
  if (inviteId) {
    await sql`DELETE FROM tandem.document_invites WHERE id = ${inviteId} AND document_id = ${id}`;
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "userId or inviteId required" }, { status: 400 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireOwner(id);
  if ("error" in r) return r.error;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (typeof body.isPublic === "boolean") {
    if (body.isPublic) {
      // Ensure slug exists
      const [d] = await sql<{ public_slug: string | null }[]>`SELECT public_slug FROM tandem.documents WHERE id = ${id}`;
      const slug = d?.public_slug ?? crypto.randomBytes(16).toString("base64url");
      await sql`UPDATE tandem.documents SET is_public = true, public_slug = ${slug} WHERE id = ${id}`;
      return NextResponse.json({ ok: true, isPublic: true, publicSlug: slug });
    }
    await sql`UPDATE tandem.documents SET is_public = false WHERE id = ${id}`;
    return NextResponse.json({ ok: true, isPublic: false, publicSlug: null });
  }
  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
