"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { Loader2 } from "lucide-react";
import * as Y from "yjs";
import { WebsocketProvider } from "@/lib/y-websocket-provider";

type Props = {
  docId: string;
  initialTitle: string;
  canEdit: boolean;
  canRename: boolean;
  user: { id: string; name: string; color: string };
};

export function Editor({ docId, initialTitle, canEdit, canRename, user }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ydoc = useMemo(() => new Y.Doc(), [docId]);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);

  useEffect(() => {
    let p: WebsocketProvider | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/ws-token?docId=${encodeURIComponent(docId)}`);
      if (!res.ok) {
        setStatus("offline");
        return;
      }
      const { token } = await res.json();
      if (cancelled) return;
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234";
      p = new WebsocketProvider(wsUrl, docId, ydoc, { params: { token } });
      p.on("status", (e: { status: string }) => {
        setStatus(e.status === "connected" ? "online" : e.status === "connecting" ? "connecting" : "offline");
      });
      p.awareness.setLocalStateField("user", { name: user.name, color: user.color });
      p.awareness.on("change", () => {
        const states = Array.from(p!.awareness.getStates().values()) as Array<{ user?: { name: string; color: string } }>;
        const others: { name: string; color: string }[] = [];
        for (const s of states) if (s.user) others.push(s.user);
        setPeers(others);
      });
      setProvider(p);
    })();
    return () => {
      cancelled = true;
      p?.destroy();
      // NOTE: don't destroy ydoc here — under React StrictMode (dev) effects
      // run twice, and the second run reuses the same useMemo'd ydoc. Destroying
      // it in cleanup leaves the second provider bound to a dead Y.Doc.
    };
  }, [docId, ydoc, user.name, user.color]);

  // We intentionally don't ydoc.destroy() on unmount — under React StrictMode
  // (dev) cleanup runs between two effect invocations and would leave the
  // second provider bound to a dead doc. GC handles cleanup when the
  // component unmounts for real.

  function onTitleChange(v: string) {
    setTitle(v);
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => {
      fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: v }),
      });
    }, 500);
  }

  useEffect(() => {
    document.title = `${title || "Untitled"} — Tandem`;
  }, [title]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={!canRename}
          placeholder="Untitled"
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-3xl"
        />
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {peers.slice(0, 5).map((p, i) => (
              <span
                key={i}
                title={p.name}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-xs font-medium text-white"
                style={{ background: p.color }}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <span
            className={`text-xs ${status === "online" ? "text-emerald-600" : status === "connecting" ? "text-muted-foreground" : "text-destructive"}`}
          >
            {status}
          </span>
        </div>
      </div>
      <div className="relative flex-1 rounded-md border bg-background p-4 sm:p-6">
        {provider ? (
          <EditorSurface ydoc={ydoc} provider={provider} canEdit={canEdit} user={user} />
        ) : (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {status === "offline" ? "Couldn't connect" : "Connecting…"}
          </div>
        )}
      </div>
    </div>
  );
}

function EditorSurface({
  ydoc,
  provider,
  canEdit,
  user,
}: {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  canEdit: boolean;
  user: { name: string; color: string };
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({ history: false }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({ provider, user: { name: user.name, color: user.color } }),
    ],
    editorProps: {
      attributes: { class: "prose prose-neutral dark:prose-invert max-w-none focus:outline-none" },
    },
  });
  return <EditorContent editor={editor} />;
}
