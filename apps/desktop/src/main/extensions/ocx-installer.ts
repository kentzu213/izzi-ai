/**
 * OpenClaw .ocx Installer
 *
 * Handles installing, uninstalling, and verifying .ocx extension packages.
 * A .ocx file is essentially a tar.gz with a validated manifest.json.
 *
 * Install flow:
 * 1. Download .ocx from marketplace or receive local file
 * 2. Extract to temp directory
 * 3. Validate manifest.json
 * 4. Check permissions → prompt user if high-risk
 * 5. Move to extensions directory
 * 6. Register in local database
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { app } from 'electron';
import { validateManifest, type OcxManifest } from './ocx-manifest';
import { validatePermissions, getHighRiskPermissions } from './permissions';

export interface InstallResult {
  success: boolean;
  extensionId?: string;
  manifest?: OcxManifest;
  installPath?: string;
  error?: string;
  warnings?: string[];
  highRiskPermissions?: string[];
}

export interface UninstallResult {
  success: boolean;
  error?: string;
}

export class OcxInstaller {
  private extensionsDir: string;
  private tempDir: string;

  constructor() {
    this.extensionsDir = path.join(app.getPath('userData'), 'extensions');
    this.tempDir = path.join(app.getPath('temp'), 'OpenClaw-install');

    // Ensure directories exist
    for (const dir of [this.extensionsDir, this.tempDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Install an extension from a directory (already extracted).
   * Used for local development and after download/extract.
   */
  async installFromDirectory(sourceDir: string): Promise<InstallResult> {
    try {
      // 1. Read and validate manifest
      const manifestPath = path.join(sourceDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return { success: false, error: 'manifest.json not found in extension package' };
      }

      const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validation = validateManifest(manifestRaw);

      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid manifest:\n${validation.errors.join('\n')}`,
          warnings: validation.warnings,
        };
      }

      const manifest = manifestRaw as OcxManifest;

      // 2. Validate entry point exists
      const mainPath = path.join(sourceDir, manifest.main);
      if (!fs.existsSync(mainPath)) {
        return { success: false, error: `Entry point "${manifest.main}" not found` };
      }

      // 3. Security: check for path traversal in files
      const traversalCheck = this.checkPathTraversal(sourceDir);
      if (!traversalCheck.safe) {
        return { success: false, error: `Security: path traversal detected in ${traversalCheck.file}` };
      }

      // 4. Validate permissions
      const permCheck = validatePermissions(manifest.permissions || []);
      if (!permCheck.valid) {
        return {
          success: false,
          error: `Unknown permissions: ${permCheck.unknown.join(', ')}`,
        };
      }

      // 5. Check for high-risk permissions (caller should prompt user)
      const highRisk = getHighRiskPermissions(manifest.permissions || []);

      // 6. Generate extension ID (deterministic from name)
      const extensionId = `ext-${manifest.name}`;

      // 7. Copy to extensions directory
      const installPath = path.join(this.extensionsDir, manifest.name);

      // Remove previous version if exists
      if (fs.existsSync(installPath)) {
        fs.rmSync(installPath, { recursive: true, force: true });
      }

      this.copyDirSync(sourceDir, installPath);

      // 8. Create integrity hash
      const integrityHash = this.computeDirectoryHash(installPath);
      fs.writeFileSync(
        path.join(installPath, '.OpenClaw-integrity'),
        JSON.stringify({ hash: integrityHash, installed: new Date().toISOString() })
      );

      console.log(`[OcxInstaller] Installed: ${manifest.displayName} v${manifest.version} → ${installPath}`);

      return {
        success: true,
        extensionId,
        manifest,
        installPath,
        warnings: validation.warnings,
        highRiskPermissions: highRisk.map(p => p.id),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Install from a .ocx file (tar.gz).
   */
  async installFromFile(ocxFilePath: string): Promise<InstallResult> {
    try {
      // Create temp extraction directory
      const extractDir = path.join(this.tempDir, `extract-${Date.now()}`);
      fs.mkdirSync(extractDir, { recursive: true });

      try {
        // Extract .ocx (tar.gz)
        // For Windows compatibility, we use a simple tar extraction
        // In production, use a tar library like 'tar' npm package
        const { execSync } = require('child_process');

        // Try tar command (available on modern Windows 10+)
        execSync(`tar -xzf "${ocxFilePath}" -C "${extractDir}"`, { stdio: 'pipe' });

        // Install from extracted directory
        return await this.installFromDirectory(extractDir);
      } finally {
        // Cleanup temp
        try {
          fs.rmSync(extractDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    } catch (err: any) {
      return { success: false, error: `Failed to extract .ocx: ${err.message}` };
    }
  }

  /**
   * Uninstall an extension by name.
   */
  async uninstall(extensionName: string): Promise<UninstallResult> {
    try {
      const installPath = path.join(this.extensionsDir, extensionName);
      if (!fs.existsSync(installPath)) {
        return { success: false, error: 'Extension not found on disk' };
      }

      fs.rmSync(installPath, { recursive: true, force: true });
      console.log(`[OcxInstaller] Uninstalled: ${extensionName}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Verify integrity of an installed extension.
   */
  verifyIntegrity(extensionName: string): { valid: boolean; error?: string } {
    try {
      const installPath = path.join(this.extensionsDir, extensionName);
      const integrityFile = path.join(installPath, '.OpenClaw-integrity');

      if (!fs.existsSync(integrityFile)) {
        return { valid: false, error: 'No integrity record found' };
      }

      const { hash: storedHash } = JSON.parse(fs.readFileSync(integrityFile, 'utf-8'));
      const currentHash = this.computeDirectoryHash(installPath);

      if (storedHash !== currentHash) {
        return { valid: false, error: 'Extension files have been modified since installation' };
      }

      return { valid: true };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Read manifest from an installed extension.
   */
  readManifest(extensionName: string): OcxManifest | null {
    try {
      const manifestPath = path.join(this.extensionsDir, extensionName, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return null;
      const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validation = validateManifest(parsed);
      return validation.valid ? parsed as OcxManifest : null;
    } catch {
      return null;
    }
  }

  /**
   * List all installed extensions' directories.
   */
  listInstalled(): string[] {
    try {
      return fs.readdirSync(this.extensionsDir).filter(name => {
        const manifestPath = path.join(this.extensionsDir, name, 'manifest.json');
        return fs.existsSync(manifestPath);
      });
    } catch {
      return [];
    }
  }

  // ── Helpers ──

  private checkPathTraversal(dir: string): { safe: boolean; file?: string } {
    const realBase = fs.realpathSync(dir);
    const walk = (d: string): { safe: boolean; file?: string } => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const fullPath = path.join(d, entry.name);
        if (entry.name.includes('..') || entry.name.startsWith('.')) {
          if (entry.name === '.OpenClaw-integrity') continue; // Our own file
          // Allow dotfiles but check for traversal
          if (entry.name.includes('..')) {
            return { safe: false, file: fullPath };
          }
        }
        const realPath = fs.realpathSync(fullPath);
        if (!realPath.startsWith(realBase)) {
          return { safe: false, file: fullPath };
        }
        if (entry.isDirectory()) {
          const sub = walk(fullPath);
          if (!sub.safe) return sub;
        }
      }
      return { safe: true };
    };
    return walk(dir);
  }

  private computeDirectoryHash(dir: string): string {
    const hash = crypto.createHash('sha256');
    const walk = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      for (const entry of entries) {
        if (entry.name === '.OpenClaw-integrity') continue;
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          hash.update(`dir:${entry.name}\n`);
          walk(fullPath);
        } else {
          const content = fs.readFileSync(fullPath);
          hash.update(`file:${entry.name}:${content.length}\n`);
          hash.update(content);
        }
      }
    };
    walk(dir);
    return hash.digest('hex');
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
