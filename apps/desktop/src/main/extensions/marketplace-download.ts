/**
 * Marketplace Download Client
 *
 * Downloads .ocx binaries from the OpenClaw Marketplace API
 * and installs them via OcxInstaller.
 *
 * Flow:
 *  1. GET /api/extensions/:id/download?format=url → signed URL + sha256
 *  2. Download binary from signed URL
 *  3. Verify SHA-256 hash
 *  4. Save to temp file → OcxInstaller.installFromFile()
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as https from "https";
import * as http from "http";
import { resolveMarketplaceUrl } from "./marketplace-url";

const MARKETPLACE_API = resolveMarketplaceUrl();

export interface MarketplaceExtensionInfo {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  downloadUrl?: string;
  sha256?: string;
}

/**
 * Get download info for an extension from the marketplace
 */
export async function getExtensionDownloadInfo(
  extensionId: string,
  authToken?: string,
): Promise<{ success: boolean; info?: MarketplaceExtensionInfo; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    // Get extension details
    const detailRes = await fetchJSON(`${MARKETPLACE_API}/api/extensions/${extensionId}`, { headers });
    if (!detailRes.extension) {
      return { success: false, error: "Extension not found" };
    }

    // Get download URL
    const downloadRes = await fetchJSON(
      `${MARKETPLACE_API}/api/extensions/${extensionId}/download?format=url`,
      { headers },
    );

    return {
      success: true,
      info: {
        id: detailRes.extension.id,
        name: detailRes.extension.name,
        displayName: detailRes.extension.display_name,
        version: downloadRes.version || detailRes.extension.version,
        description: detailRes.extension.description,
        downloadUrl: downloadRes.downloadUrl,
        sha256: downloadRes.sha256,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to get download info" };
  }
}

/**
 * Download .ocx from marketplace and save to temp directory
 * Returns the path to the downloaded file
 */
export async function downloadExtensionBinary(
  downloadUrl: string,
  expectedSha256?: string,
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const tempDir = path.join(app.getPath("temp"), "OpenClaw-downloads");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFile = path.join(tempDir, `${Date.now()}.ocx`);

  try {
    // Download binary
    await downloadToFile(downloadUrl, tempFile);

    // Verify SHA-256 if provided
    if (expectedSha256) {
      const fileBuffer = fs.readFileSync(tempFile);
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

      if (hash !== expectedSha256) {
        fs.unlinkSync(tempFile);
        return {
          success: false,
          error: `SHA-256 mismatch! Expected: ${expectedSha256.slice(0, 16)}..., Got: ${hash.slice(0, 16)}...`,
        };
      }
    }

    return { success: true, filePath: tempFile };
  } catch (err: any) {
    // Cleanup on error
    try { fs.unlinkSync(tempFile); } catch {}
    return { success: false, error: err.message || "Download failed" };
  }
}

/**
 * Full workflow: download from marketplace → install
 */
export async function installFromMarketplace(
  extensionId: string,
  authToken?: string,
): Promise<{ success: boolean; extensionPath?: string; error?: string }> {
  // Step 1: Get download info
  const { success: infoOk, info, error: infoError } = await getExtensionDownloadInfo(extensionId, authToken);
  if (!infoOk || !info?.downloadUrl) {
    return { success: false, error: infoError || "No download URL available" };
  }

  // Step 2: Download binary
  const { success: dlOk, filePath, error: dlError } = await downloadExtensionBinary(info.downloadUrl, info.sha256);
  if (!dlOk || !filePath) {
    return { success: false, error: dlError || "Download failed" };
  }

  // Step 3: Return path for OcxInstaller to handle
  return {
    success: true,
    extensionPath: filePath,
  };
}

// ── Internal helpers ──

function fetchJSON(url: string, options: { headers?: Record<string, string> } = {}): Promise<any> {
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
          reject(new Error(`Invalid JSON response from ${url}`));
        }
      });
    };

    const reqOpts = { method: "GET" as const, headers: options.headers };
    const req = isHttps
      ? https.request(parsedUrl, reqOpts, callback)
      : http.request(parsedUrl, reqOpts, callback);

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

function downloadToFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";

    const callback = (res: http.IncomingMessage) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          return downloadToFile(redirectUrl, destPath).then(resolve).catch(reject);
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });

      fileStream.on("error", (err: Error) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    };

    const req = isHttps
      ? https.get(parsedUrl, callback)
      : http.get(parsedUrl, callback);

    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("Download timeout (120s)"));
    });
  });
}
