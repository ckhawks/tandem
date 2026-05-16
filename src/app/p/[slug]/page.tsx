import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Marked } from "marked";
import { sql } from "@/lib/db";
import { renderDocumentMarkdown } from "@/lib/doc-render";

// Public-renderer marked instance: links open in a new tab with safe rel.
const marked = new Marked({
  renderer: {
    link({ href, title, tokens }: { href: string; title?: string | null; tokens: unknown[] }) {
      const text = (this as unknown as { parser: { parseInline: (t: unknown[]) => string } }).parser.parseInline(tokens);
      const safeHref = /^(https?:|mailto:|\/)/i.test(href) ? href : "#";
      const titleAttr = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
      return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
    },
  } as never,
});

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [row] = await sql<{ title: string }[]>`
    SELECT title FROM tandem.documents WHERE public_slug = ${slug} AND is_public = true LIMIT 1`;
  return { title: row?.title ? `${row.title} — Tandem` : "Tandem" };
}

export default async function PublicDoc({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [row] = await sql<{ id: string; title: string }[]>`
    SELECT id, title FROM tandem.documents
    WHERE public_slug = ${slug} AND is_public = true LIMIT 1`;
  if (!row) notFound();
  const md = await renderDocumentMarkdown(row.id);
  const html = await marked.parse(md);
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{row.title}</h1>
      <article className="prose prose-neutral dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
