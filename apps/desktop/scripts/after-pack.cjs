const fs = require('node:fs');
const path = require('node:path');

const ARCH_NAMES = {
  1: 'x64',
  3: 'arm64',
};

const REQUIRED_SHARP_RUNTIMES = {
  darwin: {
    arm64: [
      ['@img/sharp-darwin-arm64', '.node'],
      ['@img/sharp-libvips-darwin-arm64', '.dylib'],
    ],
    x64: [
      ['@img/sharp-darwin-x64', '.node'],
      ['@img/sharp-libvips-darwin-x64', '.dylib'],
    ],
  },
  win32: {
    x64: [
      ['@img/sharp-win32-x64', '.node'],
      ['@img/sharp-win32-x64', '.dll'],
    ],
  },
};

function containsNonEmptyFileWithExtension(directory, extension) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (containsNonEmptyFileWithExtension(entryPath, extension)) return true;
    } else if (entry.isFile() && entry.name.endsWith(extension) && fs.statSync(entryPath).size > 0) {
      return true;
    }
  }
  return false;
}

function packagedResourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    );
  }
  return path.join(context.appOutDir, 'resources');
}

exports.default = async function afterPack(context) {
  const platformRuntimes = REQUIRED_SHARP_RUNTIMES[context.electronPlatformName];
  if (!platformRuntimes) return;

  const arch = typeof context.arch === 'string' ? context.arch : ARCH_NAMES[context.arch];
  const requiredPackages = platformRuntimes[arch];
  if (!requiredPackages) {
    throw new Error(
      `[after-pack] Unsupported Sharp runtime target: ${context.electronPlatformName}-${String(arch)}`,
    );
  }

  const nodeModulesDir = path.join(packagedResourcesDir(context), 'app.asar.unpacked', 'node_modules');
  for (const [packageName, nativeExtension] of requiredPackages) {
    const packageDir = path.join(nodeModulesDir, ...packageName.split('/'));
    const manifestPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`[after-pack] Missing required Sharp runtime package: ${packageName}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== packageName) {
      throw new Error(`[after-pack] Invalid Sharp runtime package identity: ${packageName}`);
    }
    if (!containsNonEmptyFileWithExtension(path.join(packageDir, 'lib'), nativeExtension)) {
      throw new Error(
        `[after-pack] Missing ${nativeExtension} payload in Sharp runtime package: ${packageName}`,
      );
    }
  }
};
