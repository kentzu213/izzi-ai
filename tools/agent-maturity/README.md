# agent-maturity: upgrade checkpoint (dev pilot, slice D1)

A Claude Code `UserPromptSubmit` hook plus the `upgrade-checkpoint` skill. When the owner gives a completion
signal ("merge", "phát hành", "đồng ý", "được rồi"...) after evidence such as an earlier correction, the hook adds a
short note asking the agent to consider one upgrade question at the end of its reply. Spec: `docs/izzi-v2/PLAN.md`
§2 and §4 (§4.9 overrides §4.1–4.8).

- `lib/classify.mjs`: prompt labels (`approve_decision`, `praise`, `confirm`, `flow`, `resignation`, `correction`,
  `clarify`, `none`, `abstain`) and checkpoint reply choices. Pure.
- `lib/decide.mjs`: per-session counters and the nudge decision. Pure.
- `lib/store.mjs`, `lib/transcript-tail.mjs`: atomic state files, event log, transcript tail reader.
- `hooks/prompt-signal.mjs`: the hook. Fails open: any error exits 0 with no output, never exits 2.
- Data under `~/.claude/agent-maturity/` (or `AGENT_MATURITY_HOME`): `state/`, `global.json`, `log/`.
  No prompt or reply text is stored: only labels, counts, rule ids, timestamps and session ids.

## Install (root, slice D2)

    node tools/agent-maturity/install.mjs --dry-run
    node tools/agent-maturity/install.mjs [--claude-home <dir>] [--settings <file>]

Backs up `settings.json` byte-for-byte, copies the runtime (hooks, `critic/*.mjs`, and `standards/promote-standard.mjs`,
the single door for storing a dev standard, with its store wrapper and the refresh job) into
`<claude-home>/agent-maturity/bin/` and the skill
into `<claude-home>/skills/upgrade-checkpoint/`, then adds two hook groups, `UserPromptSubmit` (upgrade checkpoint)
and `SessionStart` (dev standards, see `standards/README.md`), each with timeout 5 s. Re-running adds only a missing
group, never a second copy; upgrading an install from before D3 keeps its original backup when `settings.json` was
not changed since. It stops if `settings.json` changes while it runs.

## Uninstall

    node tools/agent-maturity/uninstall.mjs [--dry-run] [--purge]

Restores `settings.json` byte-for-byte when nothing else changed it since install and the backup holds no
agent-maturity hook; otherwise removes only these two hook groups and keeps the backup. State and log stay unless
`--purge`.

## Turn off

`AGENT_MATURITY=off` in the environment, or `{"enabled": false}` in `~/.claude/agent-maturity/config.json`.

## Test

    pnpm run test:agent-maturity

Tests use temp folders only and assert that the real `~/.claude/agent-maturity` does not exist afterwards.
