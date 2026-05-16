import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDocAccess, getDocMeta } from "@/lib/access";
import { Editor } from "./editor";
import { ShareDialog } from "@/components/share-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const meta = await getDocMeta(id);
  return { title: meta?.title ? `${meta.title} — Tandem` : "Tandem" };
}

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/d/${id}`);

  const [access, meta] = await Promise.all([getDocAccess(id, session.user.id), getDocMeta(id)]);
  if (!meta) notFound();
  if (!access) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">You don't have access to this document.</h1>
        <Link href="/" className="mt-4 inline-block text-sm underline">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
        </Button>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {access.role === "owner" && (
            <ShareDialog docId={id} initialIsPublic={meta.is_public} initialPublicSlug={meta.public_slug} />
          )}
        </div>
      </header>

      <Editor
        docId={id}
        initialTitle={meta.title}
        canEdit={access.role === "owner" || access.role === "editor"}
        canRename={access.role === "owner" || access.role === "editor"}
        user={{ id: session.user.id, name: session.user.name ?? "Anon", color: session.user.color ?? "#888888" }}
      />
    </div>
  );
}
