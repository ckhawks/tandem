// ProseMirror-JSON -> Markdown serializer.
// Covers the StarterKit node/mark set: doc, paragraph, heading, blockquote, codeBlock,
// horizontalRule, hardBreak, bulletList, orderedList, listItem, bold, italic, strike, code, link.

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: Mark[] };
type Mark = { type: string; attrs?: Record<string, unknown> };

function escapeText(s: string): string {
  // Only escape characters that actually break inline markdown parsing.
  // Leaving '.', '-', '+', '(', ')', '{', '}', '!' alone keeps prose readable.
  return s.replace(/([\\`*_\[\]<>])/g, "\\$1");
}

function applyMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks || marks.length === 0) return text;
  let out = text;
  // Order: code first (no nested marks), then bold/italic/strike, then link wraps last.
  const has = (t: string) => marks.some((m) => m.type === t);
  if (has("code")) return `\`${text}\``;
  if (has("bold")) out = `**${out}**`;
  if (has("italic")) out = `*${out}*`;
  if (has("strike")) out = `~~${out}~~`;
  const link = marks.find((m) => m.type === "link");
  if (link) {
    const href = String((link.attrs as { href?: string } | undefined)?.href ?? "");
    out = `[${out}](${href})`;
  }
  return out;
}

function inline(nodes: Node[] | undefined): string {
  if (!nodes) return "";
  let s = "";
  for (const n of nodes) {
    if (n.type === "text") s += applyMarks(escapeText(n.text ?? ""), n.marks);
    else if (n.type === "hardBreak") s += "  \n";
  }
  return s;
}

function block(node: Node, indent = ""): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((c) => block(c)).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    case "paragraph":
      return indent + inline(node.content);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number((node.attrs as { level?: number } | undefined)?.level ?? 1)));
      return indent + "#".repeat(level) + " " + inline(node.content);
    }
    case "blockquote":
      return (node.content ?? []).map((c) => block(c, indent)).join("\n\n").split("\n").map((l) => indent + "> " + l).join("\n");
    case "codeBlock": {
      const lang = String((node.attrs as { language?: string } | undefined)?.language ?? "");
      const body = (node.content ?? []).map((c) => c.text ?? "").join("");
      return indent + "```" + lang + "\n" + body + "\n" + indent + "```";
    }
    case "horizontalRule":
      return indent + "---";
    case "bulletList":
      return (node.content ?? []).map((li) => listItem(li, indent, "- ")).join("\n");
    case "orderedList": {
      const start = Number((node.attrs as { start?: number } | undefined)?.start ?? 1);
      return (node.content ?? []).map((li, i) => listItem(li, indent, `${start + i}. `)).join("\n");
    }
    default:
      return inline(node.content);
  }
}

function listItem(li: Node, indent: string, bullet: string): string {
  const children = li.content ?? [];
  const first = children[0] ? block(children[0], "") : "";
  const rest = children.slice(1).map((c) => block(c, indent + "  ")).join("\n\n");
  return indent + bullet + first + (rest ? "\n\n" + rest : "");
}

export function prosemirrorJsonToMarkdown(doc: Node): string {
  return block(doc);
}
