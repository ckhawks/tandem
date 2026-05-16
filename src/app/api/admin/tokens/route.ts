import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const days = Math.min(90, Math.max(1, Number(body.days ?? 7)));
  const token = crypto.randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + days * 864e5);
  await sql`
    INSERT INTO tandem.signup_tokens (token, email, created_by, expires_at)
    VALUES (${token}, ${email}, ${session.user.id}, ${expires})`;
  return NextResponse.json({ token, expires_at: expires.toISOString() });
}
