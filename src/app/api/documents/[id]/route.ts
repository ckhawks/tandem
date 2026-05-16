import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getDocAccess } from "@/lib/access";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getDocAccess(id, session.user.id);
  if (!access || (access.role !== "owner" && access.role !== "editor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, 200) || "Untitled";
    await sql`UPDATE tandem.documents SET title = ${title}, updated_at = now() WHERE id = ${id}`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await getDocAccess(id, session.user.id);
  if (!access || access.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await sql`DELETE FROM tandem.documents WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
