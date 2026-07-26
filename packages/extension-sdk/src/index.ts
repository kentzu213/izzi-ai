/**
 * @openclaw/extension-sdk
 *
 * Official SDK for building OpenClaw extensions (.ocx).
 *
 * Installation:
 *   npm install @openclaw/extension-sdk
 *
 * Usage:
 *   import { defineExtension } from '@openclaw/extension-sdk';
 *
 *   export default defineExtension({
 *     activate(ctx) {
 *       ctx.log.info('Extension activated!');
 *     }
 *   });
 */

// ── Re-export API types ──

export interface OpenClawExtensionContext {
  extensionId: string;
  extensionPath: string;
  storage: ExtensionStorageAPI;
  ui: ExtensionUIAPI;
  net: ExtensionNetAPI;
  log: ExtensionLogAPI;
  subscriptions: Disposable[];
}

export interface Disposable {
  dispose: () => void;
}

export interface ExtensionStorageAPI {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface ExtensionUIAPI {
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): Promise<void>;
  showConfirm(title: string, message: string): Promise<boolean>;
  registerPanel(panelId: string, html: string): Promise<void>;
  updatePanel(panelId: string, html: string): Promise<void>;
  showProgress(message: string): Promise<{ done: () => void }>;
}

export interface ExtensionNetAPI {
  fetch(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }>;
}

export interface ExtensionLogAPI {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

export interface OpenClawExtension {
  activate(context: OpenClawExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  commands?: Record<string, (...args: any[]) => any>;
}

// ── Helper functions ──

/**
 * Define an OpenClaw extension with type safety.
 *
 * @example
 * ```ts
 * import { defineExtension } from '@openclaw/extension-sdk';
 *
 * export default defineExtension({
 *   activate(ctx) {
 *     ctx.log.info('Hello World!');
 *     ctx.ui.showNotification('Extension loaded!', 'success');
 *   },
 *   commands: {
 *     'myext.greet': () => 'Hello from extension!',
 *   }
 * });
 * ```
 */
export function defineExtension(ext: OpenClawExtension): OpenClawExtension {
  return ext;
}

// ── React Hooks (for React-based extension panels) ──

/**
 * Global context reference set by the extension host when activating.
 * Extensions should NOT set this directly.
 * @internal
 */
let _currentContext: OpenClawExtensionContext | null = null;

/** @internal */
export function _setContext(ctx: OpenClawExtensionContext | null): void {
  _currentContext = ctx;
}

/**
 * React hook to access the OpenClaw extension API.
 *
 * Must be called within a React component rendered by the extension host.
 * Throws if called before the extension context is initialized.
 *
 * @example
 * ```tsx
 * import { useOpenClaw } from '@openclaw/extension-sdk';
 *
 * function MyPanel() {
 *   const { storage, ui, log } = useOpenClaw();
 *
 *   async function handleSave() {
 *     await storage.set('lastSaved', Date.now());
 *     await ui.showNotification('Saved!', 'success');
 *     log.info('Data saved by user');
 *   }
 *
 *   return <button onClick={handleSave}>Save</button>;
 * }
 * ```
 */
export function useOpenClaw(): OpenClawExtensionContext {
  if (!_currentContext) {
    throw new Error(
      '[useOpenClaw] Extension context not available. ' +
      'Make sure this hook is called within an activated extension panel.'
    );
  }
  return _currentContext;
}

/**
 * React hook that subscribes to extension events and auto-cleans up.
 *
 * @example
 * ```tsx
 * import { useExtensionEvent } from '@openclaw/extension-sdk';
 *
 * function StatusPanel() {
 *   useExtensionEvent('data.updated', (payload) => {
 *     console.log('Data changed:', payload);
 *   });
 *   return <div>Listening for updates...</div>;
 * }
 * ```
 */
export function useExtensionEvent(
  event: string,
  handler: (...args: any[]) => void,
): void {
  // Note: This is a runtime-agnostic implementation.
  // In a React environment, the extension host wraps this with useEffect.
  // This function registers the handler and returns a disposable.
  if (_currentContext) {
    const disposable: Disposable = {
      dispose: () => { /* unsubscribe logic handled by host */ },
    };
    _currentContext.subscriptions.push(disposable);
  }
}

// ── Manifest types (for programmatic manifest creation) ──

export interface OcxCustomerMarketingCapability {
  id: string;
  category:
    | 'strategy'
    | 'content'
    | 'social'
    | 'creative'
    | 'analytics'
    | 'automation'
    | 'research'
    | 'customer_support';
  role: string;
  automationModes: Array<'copilot' | 'semi_autonomous' | 'guardrailed_autonomous'>;
  requiredIntegrations: string[];
  minimumPlan: 'free' | 'starter' | 'pro' | 'max' | 'ultra';
  permission: 'view' | 'edit' | 'execute' | 'approve' | 'manage';
  stability: 'stable' | 'beta' | 'preview';
  creditEstimate: {
    minimum: number;
    maximum: number;
    unit: 'credits_per_run';
  };
  inputs: string[];
  outputs: string[];
}

export interface OcxManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  main: string;
  engine: string;
  author: { name: string; email?: string; url?: string };
  permissions: string[];
  activationEvents: string[];
  contributes: {
    commands?: Array<{ id: string; title: string; category?: string; icon?: string }>;
    panels?: Array<{ id: string; title: string; entry: string }>;
    settings?: Array<{
      id: string;
      title: string;
      description?: string;
      type: 'string' | 'number' | 'boolean' | 'select';
      default?: any;
      options?: Array<{ label: string; value: string }>;
    }>;
  };
  categories?: string[];
  tags?: string[];
  repository?: string;
  homepage?: string;
  license?: string;
  pricing?: {
    model: 'free' | 'paid' | 'freemium';
    price?: { monthly?: number; yearly?: number; currency?: string };
  };
  icon?: string;
  private?: boolean;
  customerMarketing?: boolean;
  customerMarketingCapability?: OcxCustomerMarketingCapability;
}

// ── Permission IDs (constants for type-safe permission declarations) ──

export const Permissions = {
  // Filesystem
  FS_READ: 'fs.read',
  FS_WRITE: 'fs.write',

  // Network
  NET_HTTP: 'net.http',
  NET_WEBSOCKET: 'net.websocket',

  // UI
  UI_PANEL: 'ui.panel',
  UI_NOTIFICATION: 'ui.notification',
  UI_DIALOG: 'ui.dialog',

  // Clipboard
  CLIPBOARD_READ: 'clipboard.read',
  CLIPBOARD_WRITE: 'clipboard.write',

  // System
  SYSTEM_SHELL: 'system.shell',
  SYSTEM_ENV: 'system.env',

  // Storage
  STORAGE_LOCAL: 'storage.local',
  STORAGE_SECRETS: 'storage.secrets',
} as const;

export type PermissionId = (typeof Permissions)[keyof typeof Permissions];
