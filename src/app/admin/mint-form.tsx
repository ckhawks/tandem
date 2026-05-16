"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminMintForm() {
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<{ token: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/admin/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || null, days }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      setResult({ token: d.token, url: `${window.location.origin}/signup?token=${d.token}` });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="email" className="text-xs">Bind to email (optional)</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="any" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="days" className="text-xs">Expires in (days)</Label>
          <Input id="days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
      </div>
      <Button type="submit" disabled={busy}>Mint token</Button>
      {result && (
        <div className="rounded-md border bg-muted p-2 text-xs">
          <div className="font-mono break-all">{result.url}</div>
        </div>
      )}
    </form>
  );
}
