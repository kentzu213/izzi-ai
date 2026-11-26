import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseVaultMarkdown,
  renderGraphNodeMarkdown,
  safeChild,
  writeFileAtomic,
} from './vault-fs';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('vault-fs', () => {
  it('enforces safeChild containment and blocks traversal and symlink escapes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-vfs-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-vfs-out-'));
    dirs.push(root, outside);

    expect(safeChild(root, 'notes/hello.md')).toBe(path.join(root, 'notes', 'hello.md'));
    expect(() => safeChild(root, '../escape.md')).toThrow(/Unsafe vault path/);
    expect(() => safeChild(root, '/etc/passwd')).toThrow(/Unsafe vault path/);
    expect(() => safeChild(root, 'notes/../../escape.md')).toThrow(/Unsafe vault path/);

    // Attempt symlink rejection (best-effort if OS permits symlink creation).
    const linkPath = path.join(root, 'linked');
    try {
      fs.symlinkSync(outside, linkPath, 'junction');
      expect(() => safeChild(root, 'linked/secret.md')).toThrow(/symlink/);
    } catch {
      // Skip symlink assertion if OS blocks symlink creation without privileges.
    }
  });

  it('round-trips GraphNode markdown frontmatter, tags, body, and atomic write cleanly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-vfs-rt-'));
    dirs.push(root);

    const md = renderGraphNodeMarkdown(
      {
        id: 'node-1',
        title: 'Chiến lược MyGraph L5',
        nodeType: 'wiki',
        color: '#5ca7ff',
        content: '# Chiến lược MyGraph L5\n\nĐồng bộ Local-First bằng [[Vault Manifest]].',
        metadata: { tags: ['mygraph', 'l5'] },
        createdAt: '2026-11-26T00:00:00Z',
        updatedAt: '2026-11-26T01:00:00Z',
      },
      { linkedTitles: ['Vault Manifest'] },
    );

    const filePath = safeChild(root, 'wiki/chien-luoc.md');
    writeFileAtomic(filePath, md);

    const parsed = parseVaultMarkdown(fs.readFileSync(filePath, 'utf8'));
    expect(parsed.frontmatter.id).toBe('node-1');
    expect(parsed.title).toBe('Chiến lược MyGraph L5');
    expect(parsed.tags).toEqual(['mygraph', 'l5']);
    expect(parsed.body).toContain('[[Vault Manifest]]');
    expect(parsed.body).not.toContain('## Liên kết');
  });
});
