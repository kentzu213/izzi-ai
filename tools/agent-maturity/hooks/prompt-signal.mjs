// UserPromptSubmit hook: classifies the owner's prompt, keeps per-session counters and, at a completion
// milestone backed by evidence, adds a short note asking the agent to consider an upgrade checkpoint.
// Fails open: any error exits 0 with no output; never exits 2, never writes to stderr, never blocks a prompt.
// Stores no prompt or reply text. See docs/izzi-v2/PLAN.md §4.4 and §4.9.

const BUDGET_MS = 4000;
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

function checkpointAsk(lib, input, cls, prompt) {
  if (lib.classify.isWrapperPrompt(cls) || typeof input.transcript_path !== 'string') return { ask: null, choice: null };
  const turn = lib.tail.lastAssistantTurn(input.transcript_path);
  const asked = Boolean(turn) && turn.text.normalize('NFC').includes(lib.classify.CHECKPOINT_HEADER);
  return { ask: { asked, id: turn ? turn.id : null }, choice: asked ? lib.classify.classifyCheckpointReply(prompt) : null };
}

async function handle(lib, home, now, started) {
  const { classify, decision, store } = lib;
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? '';
  const input = JSON.parse((await readStdin()) || '{}');
  const prompt = input && typeof input.prompt === 'string' ? input.prompt : '';
  const key = store.sessionKey(input && input.session_id);
  const cls = classify.classifyPrompt(prompt);
  const preEvents = [];

  let state = null;
  if (key) {
    const loaded = store.readJson(store.statePath(home, key));
    if (loaded.status === 'corrupt') preEvents.push({ type: 'error', name: 'CorruptState' });
    state = loaded.value;
  }
  const globalRead = store.readJson(store.globalPath(home));
  const global = decision.normalizeGlobal(globalRead.value);
  const { ask, choice } = key ? checkpointAsk(lib, input, cls, prompt) : { ask: null, choice: null };

  const result = decision.decide(state, global, cls, {
    sessionId: key,
    entrypoint,
    ask,
    choice,
    lengthBucket: classify.lengthBucket(prompt),
  });

  if (key) store.writeJsonAtomic(store.statePath(home, key), result.state);
  if (globalRead.status !== 'ok' || JSON.stringify(result.global) !== JSON.stringify(global)) {
    store.writeJsonAtomic(store.globalPath(home), result.global);
  }

  const ms = Math.round(performance.now() - started);
  const stamp = { ts: now.toISOString(), session: key, ep: entrypoint };
  const events = [...preEvents, ...result.events].map((e) => ({ ...stamp, ...e, ...(e.type === 'prompt' ? { ms } : {}) }));
  logQuietly(store, home, events, now);
  try {
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
