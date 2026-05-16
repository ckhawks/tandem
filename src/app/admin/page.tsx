import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AdminMintForm } from "./mint-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Tandem" };

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin");
  if (!session.user.isAdmin) redirect("/");

  const [users, tokens] = await Promise.all([
    sql<{ id: string; email: string; display_name: string; is_admin: boolean; created_at: Date }[]>`
      SELECT id, email::text AS email, display_name, is_admin, created_at FROM tandem.users ORDER BY created_at DESC LIMIT 100`,
    sql<{ token: string; email: string | null; expires_at: Date; used_at: Date | null }[]>`
      SELECT token, email::text AS email, expires_at, used_at FROM tandem.signup_tokens
      WHERE used_at IS NULL AND expires_at > now() ORDER BY expires_at DESC LIMIT 50`,
  ]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Admin</h1>
          <ThemeToggle />
        </div>
      </header>

      <Card className="mb-6">
        <CardHeader><CardTitle>Mint signup token</CardTitle></CardHeader>
        <CardContent>
          <AdminMintForm />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Active tokens</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {tokens.length === 0 && <p className="text-muted-foreground">None.</p>}
          {tokens.map((t) => (
            <div key={t.token} className="flex items-center justify-between font-mono text-xs">
              <span className="truncate">{t.token}</span>
              <span className="text-muted-foreground">{t.email ?? "any"} • expires {new Date(t.expires_at).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Users</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between">
              <span>{u.display_name} <span className="text-muted-foreground">({u.email})</span></span>
              <span className="text-xs text-muted-foreground">{u.is_admin ? "admin" : ""}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
