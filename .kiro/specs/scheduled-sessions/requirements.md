# Scheduled Sessions — requirements

## Why

A verified automation pipeline already runs outside the app: Windows Task Scheduler triggers a
wrapper script, the wrapper runs an ordered pipeline (scrape → write → generate image → publish
blog → publish social post → comment the link), every step logs to a file, and quality gates stop
the run rather than publishing something broken (for example: never post without the generated
image, never post a body containing URLs, never double-post an already published draft).

Standing that up took manual work that a downloaded-app user cannot reasonably repeat: creating
scheduled tasks by hand, keeping browser profiles logged in, and reading raw log files to find out
why a run exited non-zero. Three of the failures observed while operating it were **session**
problems, not logic problems (a logged-out social session, a two-factor prompt, and a provider
billing modal blocking the page), and the app had nowhere to surface them.

This feature packages that standard into the product: the schedule, the ordered playbook with its
gates, the per-run log, and an explicit signal when a login session needs human attention.

## Requirements

### R1 — Create a recurring session without touching the OS scheduler
1.1 The user can create a scheduled session from the app by choosing a playbook, a time of day, and
    a recurrence (daily, or one or more weekdays).
1.2 The app registers the schedule with the operating system scheduler; the user never types a
    scheduler command.
1.3 A schedule can be enabled or disabled without losing its definition or history.
1.4 Deleting a schedule removes the OS-level registration too — no orphan tasks.

### R2 — Run the playbook as an ordered, gated pipeline
2.1 A playbook is an ordered list of steps; each step is a command with a working directory.
2.2 A step failure stops the run by default (`stopOnFailure`), so later steps cannot publish on top
    of an incomplete earlier step.
2.3 A step may be marked `continueOnError` when its output is genuinely optional.
2.4 Every run records: start time, end time, per-step exit code, and captured output (bounded).
2.5 A run started while a previous run of the same schedule is still active is refused, so a slow
    run can never overlap itself and duplicate published output.

### R3 — Make failures legible
3.1 The UI shows, per schedule: next run, last run time, last result, and which step failed.
3.2 Exit codes are translated into plain language, including the OS-level "task was refused" code
    that happens when the machine is on battery or asleep.
3.3 The user can open the full captured log of any run from the UI.

### R4 — Session health (the part that actually breaks)
4.1 The app classifies a failed step's output into a session diagnosis: logged out, two-factor
    required, provider billing/subscription block, authorisation refused, or unknown.
4.2 When a session diagnosis is present, the schedule is flagged in the UI with what the human must
    do — not just "failed".
4.3 The user can open the exact browser profile that needs attention, from the app, to log in
    manually. The app never types credentials and never stores them.
4.4 A profile whose stored session data has not changed for a long time is reported as "may have
    expired" so the user can re-login before the next scheduled run rather than after it.

### R5 — Safety
5.1 Commands come from playbooks the user selected; the app does not synthesise shell strings from
    free-form model output.
5.2 Nothing in a schedule, run record, or log surface stores credentials or tokens.
5.3 Machine-state constraints (run on battery, wake the machine, catch up a missed run) are explicit
    user choices with visible defaults, because silently skipped runs were a real observed failure.

## Out of scope

- Cross-platform scheduling beyond the current OS scheduler integration.
- Editing a playbook's steps inside the app (playbooks ship as templates in this iteration).
- Automating the human login itself.
