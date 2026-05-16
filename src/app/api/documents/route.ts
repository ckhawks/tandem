import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = await sql.begin(async (tx) => {
    const [doc] = await tx<{ id: string }[]>`
      INSERT INTO tandem.documents (owner_id, title) VALUES (${session.user.id}, 'Untitled') RETURNING id`;
    await tx`INSERT INTO tandem.document_collaborators (document_id, user_id, role)
             VALUES (${doc.id}, ${session.user.id}, 'owner')`;
    return doc.id;
  });
  return NextResponse.json({ id });
}
