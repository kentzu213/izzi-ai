#!/usr/bin/env node
// Socrates tier 1 — deterministic claim check. Zero LLM calls, zero tokens.
//
// Why this exists: the last three times the reviewer caught a real error in my
// work, all three were mechanically checkable and none needed judgement:
//   1. "SecretRef is new"      -> it existed in packages/, I had grepped only apps/
//   2. "egress touches N files" -> my count and the real count disagreed
//   3. "90% of queries need no LLM" -> a number with no source anywhere
//
// So tier 1 checks exactly those shapes and leaves judgement to tier 2 (the LLM
// reviewer), which now only runs on what tier 1 cannot decide.
//
// Usage:
//   node tools/socrates-tier1.mjs <file.md> [more.md ...]
//   node tools/socrates-tier1.mjs --repo "F:/path/to/repo" <file.md>
//   node tools/socrates-tier1.mjs --changed
//   node tools/socrates-tier1.mjs --stdin   (save hook: reads the hook payload)
//
// `--changed` checks every markdown file that differs from HEAD, including
// untracked ones. That is the mode the verification loop uses: it costs nothing
// when no document changed. With no `--repo`, it resolves the repository that
// contains this script, so a caller never hard-codes a worktree path that may
// later be removed.
//
// `--stdin` is the save-hook mode: it checks the markdown files named in the
// hook payload, each against the repository that file belongs to.
//
// Exit codes: 0 = no blocking finding, 2 = at least one blocking finding.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let repoRoot = null;
let changedOnly = false;
let fromStdin = false;
const files = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--repo') {
    repoRoot = args[index + 1] ?? null;
    index += 1;
    continue;
  }
  if (args[index] === '--changed') {
    changedOnly = true;
    continue;
  }
  if (args[index] === '--stdin') {
    fromStdin = true;
    continue;
  }
  files.push(args[index]);
}

/** The repository a path belongs to, or null when it is outside one. */
function repoOf(startDir) {
  try {
    return execFileSync('git', ['-C', startDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The repository that contains this script. Used so a caller (a save hook, a CI
 * step) never has to hard-code a worktree path that may later be removed.
 */
function repoContainingThisScript() {
  // fileURLToPath handles Windows drive letters and percent-encoded spaces,
  // which a hand-rolled URL.pathname does not.
  return repoOf(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Markdown paths mentioned anywhere in the hook payload on stdin.
 *
 * Deliberately schema-agnostic: it walks every string in the payload rather than
 * reading one known field, so a change to the payload shape degrades to "found
 * nothing" instead of checking the wrong repository.
 */
function markdownFromStdin() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return [];
  }
  const candidates = new Set();
  const consider = (value) => {
    if (typeof value !== 'string') return;
    if (!value.toLowerCase().endsWith('.md')) return;
    candidates.add(value);
  };
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') return Object.values(node).forEach(walk);
    consider(node);
  };
  try {
    walk(JSON.parse(raw));
  } catch {
    // A path containing spaces cannot be recovered from unstructured text, so
    // there is no useful fallback. Say so rather than guess.
    process.stderr.write('hook payload was not JSON; pass files explicitly instead\n');
    return [];
  }
  return [...candidates].map((p) => resolve(p)).filter((p) => existsSync(p));
}

/** Markdown files that differ from HEAD in this repository, tracked or not. */
function changedMarkdown(root) {
  const collected = new Set();
  const run = (gitArgs) => {
    try {
      return execFileSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' });
    } catch {
      return '';
    }
  };
  const lines = [
    ...run(['diff', '--name-only', 'HEAD']).split('\n'),
    ...run(['ls-files', '--others', '--exclude-standard']).split('\n'),
  ];
  for (const line of lines) {
    const relative = line.trim();
    if (!relative.toLowerCase().endsWith('.md')) continue;
    const absolute = resolve(root, relative);
    if (existsSync(absolute)) collected.add(absolute);
  }
  return [...collected];
}

if (fromStdin) {
  const found = markdownFromStdin();
  if (found.length === 0) {
    process.stdout.write('no markdown in the hook payload; nothing to check\n');
    process.exit(0);
  }
  files.push(...found);
}

if (changedOnly) {
  repoRoot = repoRoot ?? repoContainingThisScript();
  if (!repoRoot) {
    process.stderr.write('--changed needs a repository: pass --repo <path>, or run this script from inside one\n');
    process.exit(1);
  }
  files.push(...changedMarkdown(repoRoot));
  if (files.length === 0) {
    process.stdout.write('no changed markdown; nothing to check\n');
    process.exit(0);
  }
}

if (files.length === 0) {
  process.stderr.write('usage: socrates-tier1.mjs [--repo <path>] [--changed] <file.md> [...]\n');
  process.exit(1);
}

// ── checks ────────────────────────────────────────────────────────────────────

// A path-shaped token: has a separator and a file extension, or is a known
// source directory reference. Deliberately conservative to avoid false alarms
// on prose that merely contains a slash.
const PATH_PATTERN = /(?:`|"|')((?:[A-Za-z]:)?[\w.@-]+(?:[/\\][\w.@ -]+)+\.[A-Za-z0-9]{1,6})(?:`|"|')/g;
const SHA_PATTERN = /\b([0-9a-f]{7,40})\b/g;
const TAG_PATTERN = /(?:`|")((?:v\d+\.\d+\.\d+[\w.-]*|po-frozen\/[\w./-]+))(?:`|")/g;
// Numbers that assert a measurement: a percentage, a count with a noun, or a
// grouped number. Bare small integers in prose are ignored.
const MEASURED_NUMBER_PATTERN =
  /\b(\d{1,3}(?:[.,]\d{3})+|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s?(?:file|files|test|tests|token|tokens|dòng|lines|MB|GB|KB|ms|s\b))/gi;
// Claims that something does not exist. These need a count, not an assertion.
const NOVELTY_PATTERN =
  /(chưa có|chưa tồn tại|không tồn tại|không có|does not exist|is new|no legacy source|= 0 file|0 file)/gi;
// Anything that looks like a source for a number.
const EVIDENCE_HINT_PATTERN =
  /(`|arxiv|doi|http|git |rg |grep|vitest|npm |pnpm |exit code|sha256|sha512|=\s*\d)/i;

function gitAvailable(root) {
  if (!root) return false;
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitObjectExists(root, ref) {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${ref}^{object}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function paragraphsOf(text) {
  return text.split(/\n\s*\n/);
}

function checkFile(filePath, root, hasGit) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const text = readFileSync(absolute, 'utf8');
  const base = root ?? dirname(absolute);
  const findings = [];

  // 1. Every quoted path that looks like a repo path must exist.
  for (const match of text.matchAll(PATH_PATTERN)) {
    const candidate = match[1];
    // Skip URLs and obvious external references.
    if (/^https?:/i.test(candidate)) continue;
    const resolved = isAbsolute(candidate) ? candidate : resolve(base, candidate);
    if (existsSync(resolved)) continue;
    // A path may legitimately be inside another repo; only flag when the file
    // is missing from every root we know about.
    if (root && existsSync(resolve(root, candidate))) continue;
    findings.push({
      severity: 'blocking',
      rule: 'path-not-found',
      detail: candidate,
      hint: 'Quoted path does not exist. A wrong path in a runbook fails silently until an incident.',
    });
  }

  // 2. Every quoted commit sha or tag must resolve in the repo.
  if (hasGit) {
    for (const match of text.matchAll(TAG_PATTERN)) {
      if (gitObjectExists(root, match[1])) continue;
      findings.push({
        severity: 'blocking',
        rule: 'ref-not-found',
        detail: match[1],
        hint: 'Tag or version ref does not resolve in this repository.',
      });
    }
    for (const match of text.matchAll(SHA_PATTERN)) {
      const sha = match[1];
      // Ignore hex that is really a digest (64 chars) or too short to be a sha.
      if (sha.length < 7 || sha.length > 40) continue;
      if (/^[0-9]+$/.test(sha)) continue;
      if (gitObjectExists(root, sha)) continue;
      findings.push({
        severity: 'warning',
        rule: 'sha-not-found',
        detail: sha,
        hint: 'Hex token looks like a commit but does not resolve. Could also be a digest fragment.',
      });
    }
  }

  // 3. A measured number must sit in a paragraph that also carries a source.
  for (const paragraph of paragraphsOf(text)) {
    const numbers = [...paragraph.matchAll(MEASURED_NUMBER_PATTERN)].map((m) => m[1]);
    if (numbers.length === 0) continue;
    if (EVIDENCE_HINT_PATTERN.test(paragraph)) continue;
    findings.push({
      severity: 'blocking',
      rule: 'number-without-source',
      detail: numbers.slice(0, 4).join(', '),
      hint: 'Measured numbers with no command, path, or citation in the same paragraph.',
    });
  }

  // 4. A novelty claim must be backed by a count in the same paragraph.
  for (const paragraph of paragraphsOf(text)) {
    if (!NOVELTY_PATTERN.test(paragraph)) continue;
    if (/\b\d/.test(paragraph)) continue;
    findings.push({
      severity: 'warning',
      rule: 'novelty-without-count',
      detail: (paragraph.match(NOVELTY_PATTERN) ?? []).slice(0, 2).join(' / '),
      hint: 'Claims something is absent or new without a count. State the measured count and the scope searched.',
    });
  }

  return { file: absolute, findings };
}

// ── run ───────────────────────────────────────────────────────────────────────

// Each file is checked against the repository it actually belongs to, so a
// caller that passes files from several worktrees still resolves refs correctly.
const rootCache = new Map();
function rootFor(filePath) {
  if (repoRoot) return repoRoot;
  const from = dirname(isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath));
  if (!rootCache.has(from)) rootCache.set(from, repoOf(from));
  return rootCache.get(from);
}

const results = [];
for (const file of files) {
  try {
    const root = rootFor(file);
    results.push(checkFile(file, root, gitAvailable(root)));
  } catch (error) {
    results.push({
      file,
      findings: [{
        severity: 'blocking',
        rule: 'unreadable',
        detail: String(error?.message ?? error),
        hint: 'The checker could not read this file.',
      }],
    });
  }
}

let blocking = 0;
let warnings = 0;
const lines = [];
for (const result of results) {
  const blockingHere = result.findings.filter((f) => f.severity === 'blocking');
  const warningsHere = result.findings.filter((f) => f.severity === 'warning');
  blocking += blockingHere.length;
  warnings += warningsHere.length;

  lines.push(`\n${result.file}`);
  if (result.findings.length === 0) {
    lines.push('  clean');
    continue;
  }
  for (const finding of result.findings) {
    const mark = finding.severity === 'blocking' ? 'BLOCK' : 'warn ';
    lines.push(`  ${mark} [${finding.rule}] ${finding.detail}`);
    lines.push(`         ${finding.hint}`);
  }
}

lines.push(`\nfiles=${results.length} blocking=${blocking} warnings=${warnings}`);
lines.push('tier 1 is deterministic: zero LLM calls, zero tokens. Escalate only what it cannot decide.');
process.stdout.write(lines.join('\n') + '\n');
process.exit(blocking > 0 ? 2 : 0);
