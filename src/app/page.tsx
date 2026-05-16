import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { sql } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewDocButton } from "@/components/new-doc-button";
import { DocRowMenu } from "@/components/doc-row-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

type Row = { id: string; title: string; updated_at: Date; role: string; owner_name: string };

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const rows = await sql<Row[]>`
    SELECT d.id, d.title, d.updated_at, c.role, u.display_name AS owner_name
    FROM tandem.document_collaborators c
    JOIN tandem.documents d ON d.id = c.document_id
    JOIN tandem.users u ON u.id = d.owner_id
    WHERE c.user_id = ${session.user.id}
    ORDER BY d.updated_at DESC`;

  const mine = rows.filter((r) => r.role === "owner");
  const shared = rows.filter((r) => r.role !== "owner");

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Tandem</h1>
          <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {session.user.isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">Admin</Link>
            </Button>
          )}
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <Button variant="ghost" size="sm" type="submit">Sign out</Button>
          </form>
        </div>
      </header>

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">My documents</h2>
          <NewDocButton />
        </div>
        <DocList rows={mine} emptyHint="No documents yet. Click 'New' to create one." />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Shared with me</h2>
        <DocList rows={shared} emptyHint="No shared documents." showOwner />
      </section>
    </div>
  );
}

function DocList({ rows, emptyHint, showOwner }: { rows: Row[]; emptyHint: string; showOwner?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyHint}</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="relative">
          <Link href={`/d/${r.id}`}>
            <Card className="transition hover:bg-accent/40">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.title || "Untitled"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {showOwner ? `${r.owner_name} • ` : ""}edited {new Date(r.updated_at).toLocaleString()}
                  </div>
                </div>
                <span className="hidden text-xs capitalize text-muted-foreground sm:inline">{r.role}</span>
                <span className="w-8" aria-hidden /> {/* spacer for menu */}
              </CardContent>
            </Card>
          </Link>
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <DocRowMenu docId={r.id} title={r.title || "Untitled"} isOwner={r.role === "owner"} />
          </div>
        </div>
      ))}
    </div>
  );
}
