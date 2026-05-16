"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Share2, Copy, Trash } from "lucide-react";

type Collab = { user_id: string; email: string; display_name: string; role: "owner" | "editor" };
type Invite = { id: string; email: string };

export function ShareDialog({ docId, initialIsPublic, initialPublicSlug }: { docId: string; initialIsPublic: boolean; initialPublicSlug: string | null }) {
  const [open, setOpen] = useState(false);
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [slug, setSlug] = useState(initialPublicSlug);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/documents/${docId}/share`).then((r) => r.json()).then((d) => {
      setCollabs(d.collaborators);
      setInvites(d.invites);
      setIsPublic(d.isPublic);
      setSlug(d.publicSlug);
    });
  }, [open, docId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/documents/${docId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (res.ok) {
      setEmail("");
      const d = await fetch(`/api/documents/${docId}/share`).then((r) => r.json());
      setCollabs(d.collaborators);
      setInvites(d.invites);
    }
  }

  async function remove(userId: string) {
    await fetch(`/api/documents/${docId}/share?userId=${userId}`, { method: "DELETE" });
    setCollabs((cs) => cs.filter((c) => c.user_id !== userId));
  }

  async function removeInvite(id: string) {
    await fetch(`/api/documents/${docId}/share?inviteId=${id}`, { method: "DELETE" });
    setInvites((is) => is.filter((i) => i.id !== id));
  }

  async function togglePublic(checked: boolean) {
    setIsPublic(checked);
    const res = await fetch(`/api/documents/${docId}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: checked }),
    });
    const d = await res.json();
    setSlug(d.publicSlug);
  }

  const publicUrl = slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/p/${slug}` : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Share2 className="h-4 w-4" /> Share</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share document</DialogTitle>
        </DialogHeader>

        <form onSubmit={invite} className="flex gap-2">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
          <Button type="submit" disabled={busy}>Invite</Button>
        </form>

        <div className="space-y-2">
          {collabs.map((c) => (
            <div key={c.user_id} className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{c.display_name}</div>
                <div className="text-xs text-muted-foreground">{c.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs capitalize text-muted-foreground">{c.role}</span>
                {c.role !== "owner" && (
                  <Button size="icon" variant="ghost" onClick={() => remove(c.user_id)}>
                    <Trash className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium text-muted-foreground">{i.email}</div>
                <div className="text-xs text-muted-foreground">pending invite</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => removeInvite(i.id)}>
                <Trash className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Public read-only link</Label>
              <p className="text-xs text-muted-foreground">Anyone with the link can view.</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={togglePublic} />
          </div>
          {isPublic && slug && (
            <div className="mt-3 flex items-center gap-2">
              <Input readOnly value={publicUrl} />
              <Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(publicUrl)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
