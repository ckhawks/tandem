/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import { encoding, decoding } from "lib0";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import postgres from "postgres";
import { verifyWsToken } from "../src/lib/ws-token";
import { prosemirrorJsonToMarkdown } from "../src/lib/markdown";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";

const PORT = Number(process.env.WS_PORT ?? 1234);
const HOST = process.env.WS_HOST ?? "127.0.0.1";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const sql = postgres(process.env.DATABASE_URL, {
  max: 5,
  connection: { search_path: "tandem,public" },
});

const SNAPSHOT_EVERY_UPDATES = 50;
const SNAPSHOT_DEBOUNCE_MS = 5000;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

type Room = {
  id: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  conns: Map<WebSocket, Set<number>>;
  loadedSeq: number;
  pendingSinceSnapshot: number;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  saving: Promise<void>;
};

const rooms = new Map<string, Room>();

async function loadRoom(docId: string): Promise<Room> {
  const existing = rooms.get(docId);
  if (existing) return existing;

  const doc = new Y.Doc();
  doc.gc = true;

  let upToSeq = 0;
  const [snap] = await sql<{ snapshot: Buffer; up_to_seq: string }[]>`
    SELECT snapshot, up_to_seq FROM tandem.doc_snapshots WHERE document_id = ${docId} LIMIT 1`;
  if (snap) {
    Y.applyUpdate(doc, new Uint8Array(snap.snapshot));
    upToSeq = Number(snap.up_to_seq);
  }
  const newer = await sql<{ seq: string; update: Buffer }[]>`
    SELECT seq, update FROM tandem.doc_updates
    WHERE document_id = ${docId} AND seq > ${upToSeq}
    ORDER BY seq ASC`;
  for (const u of newer) {
    Y.applyUpdate(doc, new Uint8Array(u.update));
    upToSeq = Number(u.seq);
  }

  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  const room: Room = {
    id: docId,
    doc,
    awareness,
    conns: new Map(),
    loadedSeq: upToSeq,
    pendingSinceSnapshot: 0,
    snapshotTimer: null,
    saving: Promise.resolve(),
  };
  rooms.set(docId, room);

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    // Persist every incoming update; broadcast to other peers.
    if (origin !== "server-load") {
      room.saving = room.saving
        .then(async () => {
          await sql`INSERT INTO tandem.doc_updates (document_id, update) VALUES (${docId}, ${Buffer.from(update)})`;
          room.pendingSinceSnapshot++;
          if (room.pendingSinceSnapshot >= SNAPSHOT_EVERY_UPDATES) {
            await snapshot(room);
          } else {
            if (room.snapshotTimer) clearTimeout(room.snapshotTimer);
            room.snapshotTimer = setTimeout(() => {
              snapshot(room).catch((e) => console.error("snapshot error", e));
            }, SNAPSHOT_DEBOUNCE_MS);
          }
        })
        .catch((e) => console.error("persist error", e));
    }
    broadcastSyncUpdate(room, update, origin);
  });

  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = added.concat(updated, removed);
    // Track which clients each conn is tracking
    if (origin instanceof WebSocket) {
      const set = room.conns.get(origin);
      if (set) {
        for (const id of added) set.add(id);
        for (const id of removed) set.delete(id);
      }
    }
    if (changed.length === 0) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const buf = encoding.toUint8Array(enc);
    for (const conn of room.conns.keys()) send(conn, buf);
  });

  return room;
}

async function snapshot(room: Room) {
  if (room.snapshotTimer) { clearTimeout(room.snapshotTimer); room.snapshotTimer = null; }
  if (room.pendingSinceSnapshot === 0) return;
  const update = Y.encodeStateAsUpdate(room.doc);
  // Determine the seq we're caught up to: max seq present for this doc.
  const [maxRow] = await sql<{ max: string | null }[]>`SELECT max(seq) AS max FROM tandem.doc_updates WHERE document_id = ${room.id}`;
  const upTo = Number(maxRow.max ?? room.loadedSeq);
  let markdown = "";
  try {
    const frag = room.doc.getXmlFragment("default");
    const json = yXmlFragmentToProsemirrorJSON(frag) as any;
    markdown = prosemirrorJsonToMarkdown(json);
  } catch (e) {
    console.error("markdown render failed", e);
  }
  await sql`
    INSERT INTO tandem.doc_snapshots (document_id, snapshot, up_to_seq, markdown, updated_at)
    VALUES (${room.id}, ${Buffer.from(update)}, ${upTo}, ${markdown}, now())
    ON CONFLICT (document_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, up_to_seq = EXCLUDED.up_to_seq, markdown = EXCLUDED.markdown, updated_at = now()`;
  // Compact: delete updates we've folded into the snapshot.
  await sql`DELETE FROM tandem.doc_updates WHERE document_id = ${room.id} AND seq <= ${upTo}`;
  room.loadedSeq = upTo;
  room.pendingSinceSnapshot = 0;
}

function send(conn: WebSocket, data: Uint8Array) {
  if (conn.readyState === WebSocket.OPEN) conn.send(data, { binary: true });
}

function broadcastSyncUpdate(room: Room, update: Uint8Array, originConn: unknown) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeUpdate(enc, update);
  const buf = encoding.toUint8Array(enc);
  for (const conn of room.conns.keys()) {
    if (conn !== originConn) send(conn, buf);
  }
}

function onMessage(conn: WebSocket, room: Room, data: Uint8Array, canEdit: boolean) {
  try {
    const dec = decoding.createDecoder(data);
    const enc = encoding.createEncoder();
    const messageType = decoding.readVarUint(dec);
    switch (messageType) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(dec, enc, room.doc, canEdit ? conn : null);
        if (encoding.length(enc) > 1) send(conn, encoding.toUint8Array(enc));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn);
        break;
      }
    }
  } catch (e) {
    console.error("onMessage error", e);
    conn.close();
  }
}

function sendInitial(conn: WebSocket, room: Room) {
  // SyncStep1
  {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, room.doc);
    send(conn, encoding.toUint8Array(enc));
  }
  // Send current awareness state if any
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())));
    send(conn, encoding.toUint8Array(enc));
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("tandem-ws ok\n");
});
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Path: /<docId>?token=...
    const docId = url.pathname.replace(/^\//, "");
    const token = url.searchParams.get("token") ?? "";
    if (!docId || !token) return socket.destroy();
    const payload = verifyWsToken(token);
    if (!payload || payload.did !== docId) return socket.destroy();

    // Verify access still holds (token is short-lived, but role may have been revoked)
    const [access] = await sql<{ role: string }[]>`
      SELECT role FROM tandem.document_collaborators
      WHERE document_id = ${docId} AND user_id = ${payload.uid} LIMIT 1`;
    if (!access) return socket.destroy();

    wss.handleUpgrade(req, socket as any, head, (ws) => {
      handleConnection(ws, docId, access.role === "owner" || access.role === "editor");
    });
  } catch (e) {
    console.error("upgrade error", e);
    socket.destroy();
  }
});

async function handleConnection(conn: WebSocket, docId: string, canEdit: boolean) {
  conn.binaryType = "arraybuffer";

  // Buffer messages that arrive before loadRoom completes — otherwise the
  // client's initial SyncStep1 lands in a black hole and the editor never
  // receives the document state.
  const pending: Uint8Array[] = [];
  let ready = false;
  let room: Room | null = null;
  const onIncoming = (data: ArrayBuffer | Buffer) => {
    const u8 = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
    if (!ready || !room) {
      pending.push(u8);
      return;
    }
    onMessage(conn, room, u8, canEdit);
  };
  conn.on("message", onIncoming);

  room = await loadRoom(docId);
  room.conns.set(conn, new Set());
  sendInitial(conn, room);
  ready = true;
  for (const u8 of pending) onMessage(conn, room, u8, canEdit);
  pending.length = 0;
  conn.on("close", () => {
    const tracked = room.conns.get(conn);
    room.conns.delete(conn);
    if (tracked && tracked.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(tracked), null);
    }
    if (room.conns.size === 0) {
      // Flush any pending snapshot before evicting.
      snapshot(room).catch((e) => console.error("flush snapshot", e)).finally(() => {
        if (room.conns.size === 0) {
          rooms.delete(docId);
          room.doc.destroy();
        }
      });
    }
  });
  conn.on("error", (e) => console.error("ws error", e));
}

server.listen(PORT, HOST, () => {
  console.log(`tandem-ws listening on ws://${HOST}:${PORT}`);
});

// Graceful shutdown: flush snapshots
async function shutdown() {
  console.log("shutting down, flushing snapshots…");
  for (const room of rooms.values()) {
    try { await snapshot(room); } catch (e) { console.error(e); }
  }
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
