import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DOCUMENTARY_PROJECTS,
  DOCUMENTARY_TOOLS,
  DOCUMENTARY_TOOL_NAMES,
  buildDocumentaryProfilePrompt,
  classifyDocumentaryRisk,
  executeDocumentaryTool,
  findDocumentaryProject,
  guardDocumentaryHostTool,
  isDocumentaryTool,
  isSecretPath,
  resolveInsideRoot,
  type DocumentaryProject,
} from './documentary-workspace';

let root: string;
let outside: string;
let project: DocumentaryProject;

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ws-'));
  root = path.join(base, 'Channel');
  outside = path.join(base, 'Outside');
  fs.mkdirSync(path.join(root, 'episodes', 'S01E01'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'STANDARD.md'), '# Standard\n\n## 0. Definition of done\nbody\n### 0.1 Sub\nmore\n');
  fs.writeFileSync(path.join(root, 'BIBLE.md'), '# Bible\n## 1. Thesis\nThe Wang Huning rule applies.\n');
  fs.writeFileSync(path.join(root, 'episodes', 'S01E01', 'script.md'), 'line one\nWang Huning appears here\nline three\n');
  fs.writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=sk-should-never-leak\n');
  fs.writeFileSync(path.join(root, '.env.local'), 'TOKEN=also-secret\n');
  fs.writeFileSync(path.join(outside, 'private.txt'), 'outside secret');
  try {
    fs.symlinkSync(outside, path.join(root, 'escape-link'), 'junction');
  } catch {
    /* junction creation can fail on locked-down hosts; the escape test then checks nothing extra */
  }
  project = {
    id: 'test',
    name: 'Test Channel',
    root,
    authorityDocs: ['STANDARD.md', 'BIBLE.md'],
    staleDocs: ['AGENTS.md'],
  };
});

afterAll(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('documentary-workspace: registry + activation', () => {
  it('registers the I Don’t Like Trump channel with its authority docs', () => {
    const trump = DOCUMENTARY_PROJECTS.find((p) => p.id === 'trump');
    expect(trump).toBeDefined();
    expect(trump!.root).toMatch(/Trump-Was-Right-Documentary$/);
    expect(trump!.authorityDocs).toEqual(['CANONICAL_VIDEO_PRODUCTION_STANDARD.md', 'CHANNEL_BIBLE.md']);
  });

  it('activates only when the working dir is the project root or inside it', () => {
    expect(findDocumentaryProject(root, [project])?.id).toBe('test');
    expect(findDocumentaryProject(path.join(root, 'episodes'), [project])?.id).toBe('test');
    expect(findDocumentaryProject(outside, [project])).toBeNull();
    expect(findDocumentaryProject(`${root}-sibling`, [project])).toBeNull();
    expect(findDocumentaryProject('', [project])).toBeNull();
  });
});

describe('documentary-workspace: secret + containment guards', () => {
  it('flags .env files and other secret-like names', () => {
    for (const p of ['.env', '.env.local', 'a/b/.ENV.production', '.envrc', 'prod.env', 'server.pem', 'id_rsa', 'client_secret.json', 'credentials.json', 'credentials', '.npmrc']) {
      expect(isSecretPath(p)).toBe(true);
    }
    for (const p of ['CHANNEL_BIBLE.md', 'episodes/S01E01/script.md', 'environment.md', 'env.py']) {
      expect(isSecretPath(p)).toBe(false);
    }
  });

  it('resolves relative paths inside the root', async () => {
    const real = await resolveInsideRoot(root, 'episodes/S01E01/script.md');
    expect(real.toLowerCase()).toBe(fs.realpathSync.native(path.join(root, 'episodes', 'S01E01', 'script.md')).toLowerCase());
  });

  it('rejects traversal, absolute paths, secrets and junction escapes', async () => {
    await expect(resolveInsideRoot(root, '../Outside/private.txt')).rejects.toThrow(/outside/);
    await expect(resolveInsideRoot(root, path.join(outside, 'private.txt'))).rejects.toThrow(/relative/);
    await expect(resolveInsideRoot(root, 'C:secret.txt')).rejects.toThrow(/relative/);
    await expect(resolveInsideRoot(root, '.env')).rejects.toThrow(/secret/);
    await expect(resolveInsideRoot(root, 'episodes/../.env.local')).rejects.toThrow(/secret/);
    if (fs.existsSync(path.join(root, 'escape-link'))) {
      await expect(resolveInsideRoot(root, 'escape-link/private.txt')).rejects.toThrow(/outside/);
    }
  });
});

describe('documentary-workspace: tools', () => {
  it('advertises three read-only tools, all classified safe', () => {
    expect(DOCUMENTARY_TOOLS.map((t) => t.function.name).sort()).toEqual([...DOCUMENTARY_TOOL_NAMES].sort());
    for (const name of DOCUMENTARY_TOOL_NAMES) {
      expect(isDocumentaryTool(name)).toBe(true);
      expect(classifyDocumentaryRisk(name)).toBe('safe');
    }
    expect(isDocumentaryTool('read_file')).toBe(false);
    expect(classifyDocumentaryRisk('read_file')).toBeUndefined();
  });

  it('doc_list lists the root and hides secret files', async () => {
    const out = await executeDocumentaryTool(project, 'doc_list', {});
    expect(out).toContain('[FILE] STANDARD.md');
    expect(out).toContain('[DIR]  episodes');
    expect(out).not.toContain('.env');
  });

  it('doc_read returns a line window and never reads .env', async () => {
    const out = await executeDocumentaryTool(project, 'doc_read', { path: 'episodes/S01E01/script.md', offset: 2, limit: 1 });
    expect(out).toContain('Wang Huning appears here');
    expect(out).not.toContain('line one');
    const denied = await executeDocumentaryTool(project, 'doc_read', { path: '.env' });
    expect(denied).toMatch(/^error:/);
    expect(denied).not.toContain('sk-should-never-leak');
    expect(await executeDocumentaryTool(project, 'doc_read', {})).toMatch(/^error:/);
  });

  it('doc_search finds matches with file:line and skips secret files', async () => {
    const out = await executeDocumentaryTool(project, 'doc_search', { query: 'wang huning' });
    expect(out).toContain('BIBLE.md:3:');
    expect(out).toMatch(/episodes[\\/]S01E01[\\/]script\.md:2:/);
    const secret = await executeDocumentaryTool(project, 'doc_search', { query: 'sk-should-never-leak' });
    expect(secret).not.toContain('sk-should-never-leak');
    expect(await executeDocumentaryTool(project, 'doc_search', { query: '' })).toMatch(/^error:/);
  });

  it('returns an error for unknown tools instead of throwing', async () => {
    expect(await executeDocumentaryTool(project, 'doc_delete', {})).toMatch(/^error:/);
  });
});

describe('documentary-workspace: host tool guard', () => {
  it('enforces Phase 1 read-only: refuses every host write_file and run_command', () => {
    expect(guardDocumentaryHostTool('write_file', { path: 'notes.md', content: 'x' })).toMatch(/^error:.*read-only/);
    expect(guardDocumentaryHostTool('run_command', { command: 'python tools/validate.py --episode S01E01' })).toMatch(/^error:.*read-only/);
    expect(guardDocumentaryHostTool('run_command', { command: 'dir' })).toMatch(/^error:/);
  });

  it('blocks host reads and listings of secret files', () => {
    expect(guardDocumentaryHostTool('read_file', { path: '.env' })).toMatch(/^error:/);
    expect(guardDocumentaryHostTool('read_file', { path: path.join(root, '.env.local') })).toMatch(/^error:/);
    expect(guardDocumentaryHostTool('read_file', { path: 'deploy/.envrc' })).toMatch(/^error:/);
    expect(guardDocumentaryHostTool('list_dir', { path: '.git' })).toMatch(/^error:/);
  });

  it('lets ordinary host reads and non-host tools through (returns undefined)', () => {
    expect(guardDocumentaryHostTool('read_file', { path: 'CHANNEL_BIBLE.md' })).toBeUndefined();
    expect(guardDocumentaryHostTool('list_dir', { path: '.' })).toBeUndefined();
    expect(guardDocumentaryHostTool('doc_read', { path: '.env' })).toBeUndefined();
  });
});

describe('documentary-workspace: channel profile prompt', () => {
  it('names the channel, root, authority docs with their outlines, and the ground rules', async () => {
    const prompt = await buildDocumentaryProfilePrompt(project);
    expect(prompt).toContain('Test Channel');
    expect(prompt).toContain(root);
    expect(prompt).toContain('STANDARD.md');
    expect(prompt).toContain('## 0. Definition of done');
    expect(prompt).toContain('### 0.1 Sub');
    expect(prompt).toContain('## 1. Thesis');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toMatch(/not.*approval/i);
    expect(prompt).not.toContain('The Wang Huning rule applies'); // outline only, not the body
  });

  it('still builds when an authority doc is missing', async () => {
    const prompt = await buildDocumentaryProfilePrompt({ ...project, authorityDocs: ['MISSING.md'] });
    expect(prompt).toContain('MISSING.md');
    expect(prompt).toMatch(/not found/i);
  });
});
