# Operations: halting Customer Marketing gated actions

This is the incident runbook for stopping every gated Customer Marketing action:
publish, spend, bulk email, and destructive. It does not affect reading,
analysing, drafting, or staging work.

## Fastest halt: create the flag file

Create a file named `marketing-kill-switch` in the app's user data directory.
Its contents are ignored; only its presence matters. The halt is re-read on
every gated request, so it takes effect immediately, with no restart and no
rebuild.

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Izzi AI\marketing-kill-switch` |
| macOS | `~/Library/Application Support/Izzi AI/marketing-kill-switch` |
| Linux | `~/.config/Izzi AI/marketing-kill-switch` |

Windows PowerShell:

```powershell
New-Item -ItemType File -Path "$env:APPDATA\Izzi AI\marketing-kill-switch" -Force
```

macOS or Linux:

```bash
touch "$HOME/Library/Application Support/Izzi AI/marketing-kill-switch"
```

Deleting the file lifts the halt. To make the halt harder to remove by accident,
create it as a non-empty directory instead of a file — the check treats any
present path as engaged.

## Alternative: environment flag

Set `IZZI_MARKETING_KILL_SWITCH` before launching the app. Any non-empty value
engages the halt except the explicit off values `0`, `false`, `no`, and `off`.
This survives deletion of the flag file but requires a restart to change.

## What a halt looks like

Gated requests return the denial reason `kill_switch_engaged`. The response does
not say whether the halt came from the file or the environment, and it does not
disclose the configured caps.

If gated actions deny while you believe no halt is set, the flag path may be
unreadable — a permission error on the user data directory engages the halt on
purpose, so an unreadable control never reads as "safe to proceed".

## Related caps

These are separate from the halt and are checked after the caller's authority is
established. They deny with the generic `policy_denied` reason so a caller cannot
read the configured numbers back out of the response.

| Environment variable | Default | Bounds |
|---|---|---|
| `IZZI_MARKETING_MAX_SPEND_VND_PER_RUN` | 500,000 VND | one gated request |
| `IZZI_MARKETING_MAX_SPEND_VND_PER_DAY` | 2,000,000 VND | window ceiling |
| `IZZI_MARKETING_MAX_RECIPIENTS_PER_RUN` | 500 | one gated request |
| `IZZI_MARKETING_MAX_ITEMS_PER_RUN` | 50 | one gated request |

An unusable value falls back to the default rather than widening the cap. A
per-run spend cap above the window ceiling is clamped down to it. Caps are read
once per process, so changing them requires a restart.

## Known limits

- No spend ledger is wired yet, so any spend action is refused by the window
  check rather than passing with an assumed zero. The window ceiling becomes
  meaningful only once a ledger records real spend.
- The flag file lives in a directory the signed-in user can write, so anything
  running as that user can delete it. The environment flag is the stronger
  control when that matters.
- The per-run budget-shift limit from the reference guardrail model is not
  implemented, because this product has no budget-shift surface yet.
