// UserPromptSubmit hook: classifies the owner's prompt, keeps per-session counters and, at a completion
// milestone backed by evidence, adds a short note asking the agent to consider an upgrade checkpoint.
// Fails open: any error exits 0 with no output; never exits 2, never writes to stderr, never blocks a prompt.
// Stores no prompt or reply text. See docs/izzi-v2/PLAN.md §4.4 and §4.9.

const BUDGET_MS = 4000;
// Text checks read at most this many prompt characters; only the length bucket uses the full prompt.
const MAX_PROMPT_CHARS = 4096;
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
setTimeout(() => process.exit(0), BUDGET_MS).unref();

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function logQuietly(store, home, events, now) {
  try {
    store.appendEvents(home, events, now);
  } catch {
    // logging is best effort
  }
}

// The answered ask block is bound by a safe id, the sha256 of its "Đề xuất" text and its safety label; the door
// (standards/promote-standard.mjs) checks them. No text leaves this function.
function checkpointAsk(lib, input, cls, prompt) {
  if (lib.classify.isWrapperPrompt(cls) || typeof input.transcript_path !== 'string') return { ask: null, choice: null };
  const turn = lib.tail.lastAssistantTurn(input.transcript_path);
  const parts = turn ? lib.classify.checkpointAskParts(turn.text) : null;
  if (!parts) return { ask: { asked: false, id: turn ? turn.id : null }, choice: null };
  const askId = lib.store.sessionKey(turn.id);
  const ask = {
    asked: true,
    id: askId,
    askId,
    proposalSha256: parts.proposal ? lib.classify.proposalDigest(parts.proposal) : null,
    floor: parts.floor,
  };
  return { ask, choice: lib.classify.classifyCheckpointReply(prompt) };
}

async function handle(lib, home, now, started) {
  const { classify, decision, store } = lib;
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? '';
  const input = JSON.parse((await readStdin()) || '{}');
  const fullPrompt = input && typeof input.prompt === 'string' ? input.prompt : '';
  const prompt = fullPrompt.length > MAX_PROMPT_CHARS ? fullPrompt.slice(0, MAX_PROMPT_CHARS) : fullPrompt;
  const key = store.sessionKey(input && input.session_id);
  const cls = classify.classifyPrompt(prompt);
  const stamp = { ts: now.toISOString(), session: key, ep: entrypoint };
  const preEvents = [];

  const loaded = key ? store.readJson(store.statePath(home, key)) : { status: 'missing', value: null };
  const globalRead = store.readJson(store.globalPath(home));
  if (loaded.status === 'unreadable' || globalRead.status === 'unreadable') {
    // Another process may hold the file (EBUSY/EPERM): skip this turn instead of overwriting it.
    logQuietly(store, home, [{ ...stamp, type: 'error', name: 'StateUnreadable' }], now);
    return null;
  }
  if (loaded.status === 'corrupt') preEvents.push({ type: 'error', name: 'CorruptState' });
  const global = decision.normalizeGlobal(globalRead.value);
  const { ask, choice } = key ? checkpointAsk(lib, input, cls, prompt) : { ask: null, choice: null };

  const result = decision.decide(loaded.value, global, cls, {
    sessionId: key,
    entrypoint,
    ask,
    choice,
    lengthBucket: classify.lengthBucket(fullPrompt),
    nowMs: now.getTime(),
  });

  if (key) store.writeJsonAtomic(store.statePath(home, key), result.state);
  const interactive = decision.NUDGE_ENTRYPOINTS.has(entrypoint);
  if (interactive && (globalRead.status !== 'ok' || JSON.stringify(result.global) !== JSON.stringify(global))) {
    store.writeJsonAtomic(store.globalPath(home), result.global);
  }

  const ms = Math.round(performance.now() - started);
  const events = [...preEvents, ...result.events].map((e) => ({ ...stamp, ...e, ...(e.type === 'prompt' ? { ms } : {}) }));
  logQuietly(store, home, events, now);
  try {
    store.removeStaleTemp(home, now.getTime());
    store.cleanupIfDue(home, now.getTime());
  } catch {
    // cleanup is best effort
  }
  return result.context;
}

async function main() {
  const started = performance.now();
  if (String(process.env.AGENT_MATURITY ?? '').trim().toLowerCase() === 'off') return;
  const [classify, decision, store, tail] = await Promise.all([
    import('../lib/classify.mjs'),
    import('../lib/decide.mjs'),
    import('../lib/store.mjs'),
    import('../lib/transcript-tail.mjs'),
  ]);
  const home = store.resolveHome(process.env);
  if (!store.loadConfig(home).enabled) return;
  const now = new Date();
  let context = null;
  try {
    context = await handle({ classify, decision, store, tail }, home, now, started);
  } catch (error) {
    logQuietly(store, home, [{ ts: now.toISOString(), type: 'error', name: (error && error.name) || 'Error' }], now);
    return;
  }
  if (context) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
  }
}

main().then(
  () => {
    process.exitCode = 0;
  },
  () => {
    process.exitCode = 0;
  },
);
