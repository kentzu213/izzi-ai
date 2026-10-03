export type DirectorReplyInline = { text: string; strong: boolean };
export type DirectorReplyBlock =
  | { kind: 'heading'; inlines: DirectorReplyInline[] }
  | { kind: 'item'; depth: number; marker: string; inlines: DirectorReplyInline[] }
  | { kind: 'rule' }
  | { kind: 'text'; inlines: DirectorReplyInline[] };

const MAX_ITEM_DEPTH = 3;

function parseInlines(text: string): DirectorReplyInline[] {
  const inlines: DirectorReplyInline[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) inlines.push({ text: text.slice(cursor, start), strong: false });
    inlines.push({ text: match[1], strong: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) inlines.push({ text: text.slice(cursor), strong: false });
  return inlines;
}

/** Reads the markdown subset AI Director replies use, so the UI never shows raw `###`/`**`. */
export function parseDirectorReply(reply: string): DirectorReplyBlock[] {
  const blocks: DirectorReplyBlock[] = [];
  for (const rawLine of reply.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', inlines: parseInlines(heading[1]) });
      continue;
    }
    const item = /^(\s*)(?:([-*+])|(\d+[.)]))\s+(.*)$/.exec(line);
    if (item) {
      const depth = Math.min(Math.floor(item[1].length / 2), MAX_ITEM_DEPTH);
      blocks.push({ kind: 'item', depth, marker: item[3] ? item[3].replace(')', '.') : '•', inlines: parseInlines(item[4]) });
      continue;
    }
    blocks.push({ kind: 'text', inlines: parseInlines(line.trim()) });
  }
  return blocks;
}

/** One-line version for compact rows that clamp the text. */
export function directorReplyPlainText(reply: string): string {
  return parseDirectorReply(reply)
    .flatMap((block) => (block.kind === 'rule' ? [] : [block.inlines.map((inline) => inline.text).join('')]))
    .join(' ');
}

function Inlines({ inlines }: { inlines: DirectorReplyInline[] }) {
  return <>{inlines.map((inline, index) => (inline.strong ? <strong key={index}>{inline.text}</strong> : <span key={index}>{inline.text}</span>))}</>;
}

export function DirectorReplyText({ reply, className }: { reply: string; className: string }) {
  return (
    <div className={`${className} cmr-reply`}>
      {parseDirectorReply(reply).map((block, index) => {
        if (block.kind === 'rule') return <hr key={index} className="cmr-reply__rule" />;
        if (block.kind === 'heading') return <h4 key={index} className="cmr-reply__heading"><Inlines inlines={block.inlines} /></h4>;
        if (block.kind === 'item') {
          return (
            <div key={index} className={`cmr-reply__item cmr-reply__item--depth-${block.depth}`}>
              <span className="cmr-reply__marker" aria-hidden="true">{block.marker}</span>
              <span><Inlines inlines={block.inlines} /></span>
            </div>
          );
        }
        return <p key={index} className="cmr-reply__text"><Inlines inlines={block.inlines} /></p>;
      })}
    </div>
  );
}
