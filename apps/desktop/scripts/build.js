#!/usr/bin/env node

// ── Build Script for Izzi AI Desktop ──
// Usage:
//   node scripts/build.js [platform] [--sign]
//
// Platforms: win, mac, linux, all (default: current platform)
// --sign: Enable code signing (requires certificates)

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DESKTOP_DIR = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const platform = args.find(a => ['win', 'mac', 'linux', 'all'].includes(a)) || 'current';
const shouldSign = args.includes('--sign');

console.log(`
╔══════════════════════════════════════╗
║   Izzi AI Desktop Builder     ║
║   Platform: ${platform.padEnd(25)}║
║   Sign: ${(shouldSign ? 'YES' : 'NO').padEnd(28)}║
╚══════════════════════════════════════╝
`);

// ── Step 1: Build renderer (Vite) ──
console.log('📦 Building renderer...');
execSync('npx vite build', { cwd: DESKTOP_DIR, stdio: 'inherit' });

// ── Step 2: Build main process (TypeScript) ──
console.log('🔧 Building main process...');
execSync('npx tsc --project tsconfig.main.json', {
  cwd: DESKTOP_DIR,
  stdio: 'inherit',
});

// ── Step 3: Package with electron-builder ──
console.log('📦 Packaging with electron-builder...');

let buildCmd = 'npx electron-builder';

switch (platform) {
  case 'win':
    buildCmd += ' --win';
    break;
  case 'mac':
    buildCmd += ' --mac';
    break;
  case 'linux':
    buildCmd += ' --linux';
    break;
  case 'all':
    buildCmd += ' --win --mac --linux';
    break;
  default:
    // Build for current platform
    break;
}

if (!shouldSign) {
  // Skip signing for dev builds
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

buildCmd += ' --config electron-builder.json';

execSync(buildCmd, { cwd: DESKTOP_DIR, stdio: 'inherit' });

// ── Done ──
const releaseDir = path.join(DESKTOP_DIR, 'release');
if (fs.existsSync(releaseDir)) {
  const files = fs.readdirSync(releaseDir)
    .filter(f => !f.startsWith('.') && !f.endsWith('.blockmap'));
  console.log('\n✅ Build complete! Output:');
  files.forEach(f => {
    const stats = fs.statSync(path.join(releaseDir, f));
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`   📄 ${f} (${sizeMB} MB)`);
  });
} else {
  console.log('\n✅ Build complete!');
}
