/**
 * Phase C Care automatic replies, desktop side: who may switch them, strict parsing of renderer input,
 * and the script uploaded to the izzi server. The server composes and sends every reply; this app only
 * turns the switch and hands over the shop's approved facts. Customer messages never pass through here.
 *
 * @module main/customer-care/care-auto-reply
 */
import type {
  CustomerCareAutoReplyInput,
  CustomerCareAutoReplyState,
  CustomerCareRole,
  CustomerCareSetup,
} from '../../shared/customer-care-types';
import type { CareAutoReplyScript } from './care-facebook-client';

/** Mirrors the backend: only owner and manager switch automatic replies; editors may read the state. */
export const CARE_AUTO_REPLY_MANAGE_ROLES: readonly CustomerCareRole[] = ['owner', 'manager'];

export function canManageCareAutoReply(role: CustomerCareRole): boolean {
  return CARE_AUTO_REPLY_MANAGE_ROLES.includes(role);
}

/** Renderer input is exactly `{ enabled: boolean }`. */
export function parseCareAutoReplyInput(input: unknown): CustomerCareAutoReplyInput | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'enabled') return null;
  const { enabled } = input as { enabled: unknown };
  return typeof enabled === 'boolean' ? { enabled } : null;
}

/**
 * The facts the server may answer with: those approved and still valid now. Their sources stay on this
 * machine; only id, topic, the exact text and the validity window are uploaded.
 */
export function buildCareAutoReplyScript(setup: CustomerCareSetup, now: Date): CareAutoReplyScript {
  const nowMs = now.getTime();
  return {
    facts: setup.facts
      .filter((fact) => Date.parse(fact.approvedAt) <= nowMs
        && (fact.expiresAt === undefined || Date.parse(fact.expiresAt) > nowMs))
      .map((fact) => ({
        id: fact.id,
        topic: fact.topic,
        text: fact.text,
        approvedAt: fact.approvedAt,
        expiresAt: fact.expiresAt ?? null,
      })),
  };
}

export function copyCareAutoReplyState(state: CustomerCareAutoReplyState): CustomerCareAutoReplyState {
  return { ...state, lastProblem: state.lastProblem ? { ...state.lastProblem } : null };
}
