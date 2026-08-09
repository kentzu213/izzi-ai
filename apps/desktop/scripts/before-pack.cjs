/**
 * electron-builder `beforePack` hook.
 *
 * Packs EVERY first-party extension under `extensions/<name>/` (that has a
 * manifest.json + dist) into `<name>-<version>.ocx` in
 * `apps/desktop/resources/bundled-extensions/`, so the packaged app can install
 * them offline in ONE click (the marketplace "install" reads the bundled file
 * first). Because `*.ocx` is gitignored, packages are generated fresh at build
 * time from the committed source — never a stale committed binary.
 *
 * Voice Studio is required by the Marketing Room repair flow, so its package is
 * fail-closed: a clean checkout cannot produce a desktop release without the
 * current bundled OCX. Other extension failures still fall back to Marketplace.
 *
 * @param {import('electron-builder').BeforePackContext} _context
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const REQUIRED_BUNDLED_EXTENSIONS = new Set(['voice-studio']);

exports.default = async function beforePack(_context) {
  const appDir = path.resolve(__dirname, '..'); // apps/desktop
  const extRoot = path.resolve(appDir, '../../extensions');
  const outDir = path.join(appDir, 'resources', 'bundled-extensions');
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(extRoot)) throw new Error(`Bundled extension source root is missing: ${extRoot}`);

  for (const requiredName of REQUIRED_BUNDLED_EXTENSIONS) {
    const requiredRoot = path.join(extRoot, requiredName);
    const hasManifest = fs.existsSync(path.join(requiredRoot, 'manifest.json'));
    const hasDist = fs.existsSync(path.join(requiredRoot, 'dist'));
    if (!hasManifest || !hasDist) {
      throw new Error(`Required bundled extension source is incomplete: ${requiredName}`);
    }
  }

  const dirs = fs.readdirSync(extRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    const srcDir = path.join(extRoot, d.name);
    const manifestPath = path.join(srcDir, 'manifest.json');
    // Require manifest + dist (the entry point); skip loose dirs.
    if (!fs.existsSync(manifestPath) || !fs.existsSync(path.join(srcDir, 'dist'))) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const version = manifest.version || '0.0.0';
      for (const name of fs.readdirSync(outDir)) {
        if (name.startsWith(`${d.name}-`) && name.endsWith('.ocx')) {
          fs.rmSync(path.join(outDir, name), { force: true });
        }
      }
      // manifest + dist required; README + service (managed backend) optional.
      const entries = ['manifest.json', 'dist'];
      if (fs.existsSync(path.join(srcDir, 'README.md'))) entries.splice(1, 0, 'README.md');
      if (fs.existsSync(path.join(srcDir, 'service'))) entries.push('service');
      const outFile = path.join(outDir, `${d.name}-${version}.ocx`);
      // `tar` is available on windows-latest, macos-latest and linux CI runners.
      execFileSync('tar', [
        '--exclude=__pycache__',
        '--exclude=*.pyc',
        '--exclude=*.pyo',
        '--exclude=.pytest_cache',
        '-czf',
        outFile,
        '-C',
        srcDir,
        ...entries,
      ], { stdio: 'pipe' });
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
        throw new Error(`tar produced no package for ${d.name}`);
      }
      console.log('[before-pack] packed bundled extension \u2192', outFile);
    } catch (error) {
      if (REQUIRED_BUNDLED_EXTENSIONS.has(d.name)) {
        throw new Error(`Failed to pack required extension ${d.name}: ${error && error.message}`);
      }
      console.warn(`[before-pack] skip ${d.name}:`, error && error.message);
    }
  }
};
