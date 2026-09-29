/**
 * Extension Auto-Update Checker
 *
 * Periodically checks the Marketplace API for newer versions
 * of installed extensions and notifies the UI.
 *
 * Usage:
 *   const checker = new ExtensionUpdateChecker(extensionLoader);
 *   checker.start(); // Checks every 6 hours
 *   const updates = await checker.checkAll();
 */
import * as http from "http";
import * as https from "https";
import { resolveMarketplaceUrl } from "./marketplace-url";

const MARKETPLACE_API = resolveMarketplaceUrl();
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UpdateInfo {
  extensionId: string;
  extensionName: string;
  currentVersion: string;
  latestVersion: string;
  downloadUrl?: string;
  sha256?: string;
}

/**
 * Compare semver versions. Returns true if `latest` > `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
  const parseSemver = (v: string) => {
    const parts = v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };

  const c = parseSemver(current);
  const l = parseSemver(latest);

  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

export class ExtensionUpdateChecker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private extensionLoader: any; // ExtensionLoader — avoid circular import
  private pendingUpdates: UpdateInfo[] = [];

  constructor(extensionLoader: any) {
    this.extensionLoader = extensionLoader;
  }

  /**
   * Start periodic update checking
   */
  start(intervalMs = CHECK_INTERVAL_MS): void {
    // Check once after 30 seconds (let the app settle)
    setTimeout(() => this.checkAll(), 30_000);

    this.intervalHandle = setInterval(() => this.checkAll(), intervalMs);
    console.log(`[UpdateChecker] Started — checking every ${intervalMs / 3600000}h`);
  }

  /**
   * Stop periodic checking
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Get pending updates (cached from last check)
   */
  getPendingUpdates(): UpdateInfo[] {
    return [...this.pendingUpdates];
  }

  /**
   * Check all installed extensions against the marketplace
   */
  async checkAll(): Promise<UpdateInfo[]> {
    const updates: UpdateInfo[] = [];

    try {
      // Get list of installed runtime extensions
      const installed = this.extensionLoader?.getAllExtensions?.() || [];

      if (installed.length === 0) {
        this.pendingUpdates = [];
        return [];
      }

      console.log(`[UpdateChecker] Checking ${installed.length} extensions for updates...`);

      // Check each extension (batch, but sequentially to be nice to the API)
      for (const ext of installed) {
        try {
          const update = await this.checkSingle(ext.id, ext.name, ext.manifest?.version || ext.version);
          if (update) {
            updates.push(update);
          }
        } catch (err) {
          // Single failure shouldn't stop the whole check
          console.warn(`[UpdateChecker] Failed to check ${ext.name}:`, err);
        }
      }

      this.pendingUpdates = updates;

      if (updates.length > 0) {
        console.log(`[UpdateChecker] Found ${updates.length} update(s):`,
          updates.map(u => `${u.extensionName} ${u.currentVersion} → ${u.latestVersion}`).join(", "));
      } else {
        console.log("[UpdateChecker] All extensions up to date");
      }
    } catch (err) {
      console.error("[UpdateChecker] Check failed:", err);
    }

    return updates;
  }

  /**
   * Check a single extension for updates
   */
  private async checkSingle(
    extensionId: string,
    extensionName: string,
    currentVersion: string,
  ): Promise<UpdateInfo | null> {
    try {
      const data = await this.fetchJSON(
        `${MARKETPLACE_API}/api/extensions/${extensionId}/versions`,
      );

      if (!data?.currentVersion) return null;

      const latestVersion = data.currentVersion;

      if (isNewerVersion(currentVersion, latestVersion)) {
        return {
          extensionId,
          extensionName,
          currentVersion,
          latestVersion,
        };
      }
    } catch {
      // API might be offline — that's fine
    }

    return null;
  }

  /**
   * Minimal JSON fetcher (no external deps)
   */
  private fetchJSON(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";

      const callback = (res: http.IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid JSON"));
          }
        });
      };

      const req = isHttps
        ? https.request(parsedUrl, { method: "GET" }, callback)
        : http.request(parsedUrl, { method: "GET" }, callback);

      req.on("error", reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
      req.end();
    });
  }
}
