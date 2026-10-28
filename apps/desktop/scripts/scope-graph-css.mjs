import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Usage: node apps/desktop/scripts/scope-graph-css.mjs [source.css] [output.css]
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, '..');
const [sourceArgument, outputArgument] = process.argv.slice(2);
const sourcePath = path.resolve(
  sourceArgument ?? path.join(desktopRoot, 'node_modules/@kentzu213/graph-view/dist/graph.css'),
);
const outputPath = path.resolve(
  outputArgument ?? path.join(desktopRoot, 'src/renderer/styles/graph-view-scoped.css'),
);

// Vite is a direct desktop dev dependency and owns the PostCSS version used by
// the renderer build. Resolve PostCSS from Vite so pnpm's strict dependency
// layout remains reproducible without adding another package or touching locks.
const requireFromDesktop = createRequire(path.join(desktopRoot, 'package.json'));
const requireFromVite = createRequire(requireFromDesktop.resolve('vite/package.json'));
const postcss = requireFromVite('postcss');

const source = await readFile(sourcePath, 'utf8');
const root = postcss.parse(source, { from: sourcePath });
const keyframeNames = new Map();

root.walkAtRules((atRule) => {
  if (!/^(?:-\w+-)?keyframes$/i.test(atRule.name)) return;
  const original = atRule.params.trim();
  const scoped = original.startsWith('gv-') ? original : `gv-${original}`;
  keyframeNames.set(original, scoped);
  atRule.params = scoped;
});

function isInsideKeyframes(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /^(?:-\w+-)?keyframes$/i.test(parent.name)) return true;
  }
  return false;
}

function scopeSelector(selector) {
  let scoped = selector.trim().replace(/:root\b/g, '.graphview-scope');
  scoped = scoped.replace(/^(?:html|body)(?=$|[\s.#:[>+~])/, '.graphview-scope');
  if (/^\.graphview-scope(?=$|[\s.#:[>+~])/.test(scoped)) return scoped;
  return `.graphview-scope ${scoped}`;
}

root.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return;
  rule.selectors = rule.selectors.map(scopeSelector);
});

root.walkDecls((declaration) => {
  if (declaration.prop.toLowerCase() === 'position' && declaration.value.trim().toLowerCase() === 'fixed') {
    declaration.value = 'absolute';
  }

  if (!/^animation(?:-name)?$/i.test(declaration.prop)) return;
  for (const [original, scoped] of keyframeNames) {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    declaration.value = declaration.value.replace(
      new RegExp(`(^|[^\\w-])${escaped}(?=$|[^\\w-])`, 'g'),
      `$1${scoped}`,
    );
  }
});

const banner = '/* AUTO-GENERATED from @kentzu213/graph-view/dist/graph.css — scoped under .graphview-scope, keyframes namespaced gv-*. Do not edit by hand. */\n';
const result = banner + root.toString();
const verification = postcss.parse(result, { from: outputPath });
const failures = [];

verification.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return;
  for (const selector of rule.selectors) {
    if (!/^\.graphview-scope(?=$|[\s.#:[>+~])/.test(selector.trim())) {
      failures.push(`unscoped selector: ${selector}`);
    }
  }
});
verification.walkDecls((declaration) => {
  if (declaration.prop.toLowerCase() === 'position' && declaration.value.trim().toLowerCase() === 'fixed') {
    failures.push(`position fixed at ${declaration.source?.start?.line ?? '?'}`);
  }
});
if (result.includes(':root')) failures.push('unconverted :root selector');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

await writeFile(outputPath, result, 'utf8');
console.log(JSON.stringify({
  source: sourcePath,
  output: outputPath,
  rules: verification.nodes.length,
  keyframes: [...keyframeNames.values()],
  bytes: Buffer.byteLength(result),
}));
