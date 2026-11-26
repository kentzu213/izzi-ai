/**
 * Wikilink parse / resolve helpers for vault notes.
 * Pure module — shared by main + renderer.
 *
 * Supported forms:
 *  - [[Page Title]]
 *  - [[Page Title|display]]
 *  - [[node-id|label]] when target looks like an id
 */

export interface WikiLinkRef {
  /** Raw inside [[...]] without brackets */
  raw: string;
  /** Target title or id */
  target: string;
  /** Display label (defaults to target) */
  label: string;
  /** Start index in source (inclusive of [[) */
  start: number;
  /** End index exclusive (after ]]) */
  end: number;
}

const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;

/** Extract all wikilinks from markdown body. */
export function parseWikilinks(markdown: string): WikiLinkRef[] {
  const src = String(markdown ?? '');
  const out: WikiLinkRef[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(src)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    const pipe = raw.indexOf('|');
    const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    const label = (pipe >= 0 ? raw.slice(pipe + 1) : target).trim();
    if (!target) continue;
    out.push({
      raw,
      target,
      label: label || target,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Unique targets in document order. */
export function uniqueWikilinkTargets(markdown: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const w of parseWikilinks(markdown)) {
    const key = w.target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(w.target);
  }
  return ordered;
}

export interface ResolveHit {
  id: string;
  title: string;
}

/**
 * Resolve a wikilink target against known nodes.
 * 1) exact id match
 * 2) case-insensitive title match
 * 3) null if missing
 */
export function resolveWikilinkTarget(
  target: string,
  nodes: ReadonlyArray<{ id: string; title: string }>,
): ResolveHit | null {
  const t = target.trim();
  if (!t) return null;
  const byId = nodes.find((n) => n.id === t);
  if (byId) return { id: byId.id, title: byId.title };
  const lower = t.toLowerCase();
  const byTitle = nodes.find((n) => n.title.trim().toLowerCase() === lower);
  if (byTitle) return { id: byTitle.id, title: byTitle.title };
  return null;
}

/** Escape HTML text nodes (XSS-safe base for preview). */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal GFM-ish preview: escape first, then light transforms.
 * No raw HTML passthrough (security).
 */
export function markdownToSafeHtml(markdown: string): string {
  const text = String(markdown ?? '');
  // Protect fenced code blocks
  const fences: string[] = [];
  let body = text.replace(/```([\s\S]*?)```/g, (_, code: string) => {
    const i = fences.length;
    fences.push(`<pre class="vault-pre"><code>${escapeHtml(code.replace(/^\n/, ''))}</code></pre>`);
    return `\u0000FENCE${i}\u0000`;
  });

  body = escapeHtml(body);

  // Headings
  body = body.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  body = body.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  body = body.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  body = body.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  body = body.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  body = body.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Bold / italic / inline code
  body = body.replace(/`([^`]+)`/g, '<code>$1</code>');
  body = body.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  body = body.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Wikilinks → span (resolved client-side later if needed)
  body = body.replace(
    /\[\[([^\[\]]+?)\]\]/g,
    (_m, inner: string) => {
      const pipe = inner.indexOf('|');
      const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const label = (pipe >= 0 ? inner.slice(pipe + 1) : target).trim();
      return `<span class="vault-wikilink" data-target="${escapeHtml(target)}">${escapeHtml(label || target)}</span>`;
    },
  );

  // Unordered lists (simple line-based)
  body = body.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>');
  body = body.replace(/(?:<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`);

  // Paragraphs: double newlines
  body = body
    .split(/\n{2,}/)
    .map((para) => {
      if (/^<(h[1-6]|ul|pre|blockquote)/.test(para.trim())) return para;
      return `<p>${para.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  // Restore fences
  body = body.replace(/\u0000FENCE(\d+)\u0000/g, (_, i) => fences[Number(i)] ?? '');

  return body;
}
