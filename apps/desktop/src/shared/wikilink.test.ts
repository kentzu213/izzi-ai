import { describe, expect, it } from 'vitest';
import {
  parseWikilinks,
  uniqueWikilinkTargets,
  resolveWikilinkTarget,
  escapeHtml,
  markdownToSafeHtml,
} from './wikilink';

describe('parseWikilinks', () => {
  it('parses simple and labeled links', () => {
    const md = 'See [[Pricing]] and [[abc-id|Billing page]].';
    const links = parseWikilinks(md);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ target: 'Pricing', label: 'Pricing' });
    expect(links[1]).toMatchObject({ target: 'abc-id', label: 'Billing page' });
  });

  it('dedupes unique targets case-insensitively', () => {
    const u = uniqueWikilinkTargets('[[Foo]] then [[foo]] and [[Bar]]');
    expect(u).toEqual(['Foo', 'Bar']);
  });
});

describe('resolveWikilinkTarget', () => {
  const nodes = [
    { id: 'n1', title: 'Pricing' },
    { id: 'uuid-xyz', title: 'Other' },
  ];

  it('resolves by title case-insensitive', () => {
    expect(resolveWikilinkTarget('pricing', nodes)?.id).toBe('n1');
  });

  it('resolves by id', () => {
    expect(resolveWikilinkTarget('uuid-xyz', nodes)?.title).toBe('Other');
  });

  it('returns null when missing', () => {
    expect(resolveWikilinkTarget('Nope', nodes)).toBeNull();
  });
});

describe('markdownToSafeHtml', () => {
  it('escapes raw HTML', () => {
    const html = markdownToSafeHtml('<script>alert(1)</script> hi');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders heading and wikilink', () => {
    const html = markdownToSafeHtml('# Hello\n\nLink [[Page]]');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('vault-wikilink');
    expect(html).toContain('data-target="Page"');
  });

  it('escapeHtml encodes entities', () => {
    expect(escapeHtml(`a&b<c>`)).toBe('a&amp;b&lt;c&gt;');
  });
});
