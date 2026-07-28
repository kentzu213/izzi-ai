// ── Device Guard Service ──
// Hardware fingerprinting and session security for Izzi AI.
// Ported from tuanminhhole/openclaw-setup infra/device-guard.ts

import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ──

export interface DeviceFingerprint {
  id: string;             // SHA-256 hash of hardware identifiers
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGB: number;
  username: string;
  createdAt: number;
}

export interface DeviceSession {
  deviceId: string;
  sessionId: string;
  startedAt: number;
  lastActivity: number;
  ipAddress?: string;
}

export interface DeviceGuardConfig {
  maxDevices: number;              // Max simultaneous devices per account
  sessionTimeoutMs: number;        // Auto-logout after inactivity
  requireFingerprint: boolean;
  allowedPlatforms: string[];
}

// ── Defaults ──

const DEFAULT_CONFIG: DeviceGuardConfig = {
  maxDevices: 3,
  sessionTimeoutMs: 24 * 60 * 60 * 1000,  // 24 hours
  requireFingerprint: true,
  allowedPlatforms: ['win32', 'darwin', 'linux'],
};

// ── Service ──

export class DeviceGuardService {
  private config: DeviceGuardConfig;
  private dataPath: string;
  private fingerprint: DeviceFingerprint | null = null;
  private sessions: DeviceSession[] = [];

  constructor(dataDir?: string) {
    const baseDir = dataDir || path.join(os.homedir(), '.openclaw');
    this.dataPath = path.join(baseDir, 'device');
    this.config = { ...DEFAULT_CONFIG };
    this.ensureDir();
    this.loadData();
  }

  // ── Generate device fingerprint ──

  getFingerprint(): DeviceFingerprint {
    if (this.fingerprint) return this.fingerprint;

    const cpus = os.cpus();
    const raw = [
      os.hostname(),
      os.platform(),
      os.arch(),
      cpus[0]?.model || 'unknown',
      cpus.length.toString(),
      Math.round(os.totalmem() / (1024 * 1024 * 1024)).toString(),
      os.userInfo().username,
    ].join('|');

    const id = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

    this.fingerprint = {
      id,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model || 'unknown',
      cpuCores: cpus.length,
      totalMemoryGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
      username: os.userInfo().username,
      createdAt: Date.now(),
    };

    this.saveFingerprint();
    return this.fingerprint;
  }

  // ── Create session ──

  createSession(ipAddress?: string): DeviceSession {
    const fp = this.getFingerprint();
    const session: DeviceSession = {
      deviceId: fp.id,
      sessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      lastActivity: Date.now(),
      ipAddress,
    };

    // Remove expired sessions
    this.cleanupSessions();

    // Check device limit
    const uniqueDevices = new Set(this.sessions.map(s => s.deviceId));
    if (uniqueDevices.size >= this.config.maxDevices && !uniqueDevices.has(fp.id)) {
      // Remove oldest session from oldest device
      const oldest = this.sessions.sort((a, b) => a.lastActivity - b.lastActivity)[0];
      if (oldest) {
        this.sessions = this.sessions.filter(s => s.sessionId !== oldest.sessionId);
      }
    }

    this.sessions.push(session);
    this.saveSessions();
    return session;
  }

  // ── Heartbeat ──

  heartbeat(sessionId: string): boolean {
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (!session) return false;
    session.lastActivity = Date.now();
    this.saveSessions();
    return true;
  }

  // ── Validate session ──

  isValidSession(sessionId: string): boolean {
    const session = this.sessions.find(s => s.sessionId === sessionId);
    if (!session) return false;

    const elapsed = Date.now() - session.lastActivity;
    if (elapsed > this.config.sessionTimeoutMs) {
      this.endSession(sessionId);
      return false;
    }

    return true;
  }

  // ── End session ──

  endSession(sessionId: string): void {
    this.sessions = this.sessions.filter(s => s.sessionId !== sessionId);
    this.saveSessions();
  }

  // ── List active sessions ──

  getActiveSessions(): DeviceSession[] {
    this.cleanupSessions();
    return [...this.sessions];
  }

  // ── Platform check ──

  isPlatformAllowed(): boolean {
    return this.config.allowedPlatforms.includes(os.platform());
  }

  // ── System info (for diagnostics) ──

  getSystemInfo(): Record<string, string | number> {
    const fp = this.getFingerprint();
    return {
      deviceId: fp.id,
      hostname: fp.hostname,
      platform: fp.platform,
      arch: fp.arch,
      cpuModel: fp.cpuModel,
      cpuCores: fp.cpuCores,
      totalMemoryGB: fp.totalMemoryGB,
      freeMemoryGB: Math.round(os.freemem() / (1024 * 1024 * 1024)),
      uptime: Math.round(os.uptime() / 3600),
      nodeVersion: process.version,
      electronVersion: process.versions.electron || 'N/A',
    };
  }

  // ── Config ──

  setConfig(config: Partial<DeviceGuardConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): DeviceGuardConfig {
    return { ...this.config };
  }

  // ── Internal ──

  private cleanupSessions(): void {
    const now = Date.now();
    this.sessions = this.sessions.filter(
      s => (now - s.lastActivity) < this.config.sessionTimeoutMs,
    );
    this.saveSessions();
  }

  private ensureDir(): void {
    try { fs.mkdirSync(this.dataPath, { recursive: true }); } catch { /* ignore */ }
  }

  private loadData(): void {
    try {
      const fpFile = path.join(this.dataPath, 'fingerprint.json');
      if (fs.existsSync(fpFile)) {
        this.fingerprint = JSON.parse(fs.readFileSync(fpFile, 'utf-8'));
      }
    } catch { /* regenerate */ }

    try {
      const sessFile = path.join(this.dataPath, 'sessions.json');
      if (fs.existsSync(sessFile)) {
        this.sessions = JSON.parse(fs.readFileSync(sessFile, 'utf-8'));
      }
    } catch { this.sessions = []; }
  }

  private saveFingerprint(): void {
    try {
      fs.writeFileSync(
        path.join(this.dataPath, 'fingerprint.json'),
        JSON.stringify(this.fingerprint, null, 2),
        'utf-8',
      );
    } catch { /* ignore */ }
  }

  private saveSessions(): void {
    try {
      fs.writeFileSync(
        path.join(this.dataPath, 'sessions.json'),
        JSON.stringify(this.sessions, null, 2),
        'utf-8',
      );
    } catch { /* ignore */ }
  }
}
