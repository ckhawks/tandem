import { sql } from "./db";

export type Role = "owner" | "editor";

export async function getDocAccess(documentId: string, userId: string): Promise<{ role: Role } | null> {
  const [row] = await sql<{ role: Role }[]>`
    SELECT role FROM tandem.document_collaborators
    WHERE document_id = ${documentId} AND user_id = ${userId} LIMIT 1`;
  return row ?? null;
}

export async function getDocMeta(documentId: string) {
  const [row] = await sql<{ id: string; title: string; owner_id: string; is_public: boolean; public_slug: string | null }[]>`
    SELECT id, title, owner_id, is_public, public_slug FROM tandem.documents WHERE id = ${documentId} LIMIT 1`;
  return row ?? null;
}
