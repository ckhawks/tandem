import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDocAccess } from "@/lib/access";
import { signWsToken } from "@/lib/ws-token";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const docId = new URL(req.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "Missing docId" }, { status: 400 });
  const access = await getDocAccess(docId, session.user.id);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const token = signWsToken({
    uid: session.user.id,
    did: docId,
    name: session.user.name ?? "Anon",
    color: session.user.color ?? "#888888",
    role: access.role,
  });
  return NextResponse.json({ token });
}
