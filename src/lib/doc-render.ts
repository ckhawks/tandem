import "server-only";
import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { sql } from "./db";
import { prosemirrorJsonToMarkdown } from "./markdown";

// Materializes a document's current markdown from its Yjs state.
// Loads snapshot + any newer updates, converts to ProseMirror JSON, serializes.
// Used by the public read-only renderer so viewers don't depend on the
// ws server's debounced snapshot to have run yet.
export async function renderDocumentMarkdown(documentId: string): Promise<string> {
  const doc = new Y.Doc();

  const [snap] = await sql<{ snapshot: Buffer; up_to_seq: string }[]>`
    SELECT snapshot, up_to_seq FROM tandem.doc_snapshots WHERE document_id = ${documentId} LIMIT 1`;
  let upTo = 0;
  if (snap) {
    Y.applyUpdate(doc, new Uint8Array(snap.snapshot));
    upTo = Number(snap.up_to_seq);
  }
  const newer = await sql<{ update: Buffer }[]>`
    SELECT update FROM tandem.doc_updates
    WHERE document_id = ${documentId} AND seq > ${upTo}
    ORDER BY seq ASC`;
  for (const u of newer) Y.applyUpdate(doc, new Uint8Array(u.update));

  try {
    const frag = doc.getXmlFragment("default");
    const json = yXmlFragmentToProsemirrorJSON(frag);
    return prosemirrorJsonToMarkdown(json as never);
  } finally {
    doc.destroy();
  }
}
