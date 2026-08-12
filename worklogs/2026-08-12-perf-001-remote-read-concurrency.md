# PERF-001 Remote-Read Concurrency

Date: 2026-08-12 ICT

Scope: intended to reduce Customer Marketing snapshot latency by overlapping two independent
authenticated remote reads. No installed-runtime speed improvement is claimed in this slice. This
slice does not add provider calls, external actions, publishing, spending, installer behavior, or
signing behavior.

## Change

- Resolve the authoritative workspace first.
- Start profile and capability reads together using that confirmed workspace ID.
- Preserve the existing unavailable and forbidden fail-closed mappings.
- Add a contract test that holds both reads open and proves both started before either completed.

## Verification

- Focused concurrency contract: 1/1 passed with
  `pnpm --filter @openclaw/desktop exec vitest run src/main/customer-marketing/customer-marketing-service.test.ts -t "starts profile and capability reads together"`.
- Customer Marketing service: 163/163 passed with
  `pnpm --filter @openclaw/desktop exec vitest run src/main/customer-marketing/customer-marketing-service.test.ts`.
- Desktop regression: 1,279/1,279 passed across 88 files with
  `pnpm --filter @openclaw/desktop test`.
- Production build passed with `pnpm --filter @openclaw/desktop build`.
- Desktop lint passed with `pnpm --filter @openclaw/desktop lint`.
- Renderer budget passed 2/2 with `pnpm test:renderer-budget`.
- Scoped secret scan command:
  `$hits = rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!out/**' '(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})' apps/desktop/src apps/desktop/scripts tools; $code = $LASTEXITCODE; if ($code -eq 0) { $hits; throw 'High-confidence secret pattern found.' } elseif ($code -eq 1) { 'No high-confidence secret patterns found in scoped source/scripts.' } else { throw "Secret scan failed with rg exit code $code." }`.
  It searched the named Desktop source/scripts and root tools for the named OpenAI, GitHub, and
  AWS key shapes; the wrapper exited 0 and printed `No high-confidence secret patterns found in scoped source/scripts.`
- GitNexus pre-commit tool call:
  `gitnexus_changes({ projectPath: "F:\\3 AI-Automation\\izziAi Marketing\\.izzi-ai-cmr214-signing-20260812", scope: "unstaged" })`.
  Final staged result: `changed_count=5`, `affected_count=3`, `changed_files=4`,
  `risk_level=medium`.

## Public Commit And Internal Draft

- Product commit: `8d740183b91e6bd68ab845122e4061d3153e87aa`.
- Version commit and beta35 tag target: `de2dc1e3c39e105a8244834e14489bef03c31ef5`.
- Product CI `31594055907` and version CI `31594293299` both passed Windows and macOS.
- Release workflow `31594296507` passed Windows, macOS and inventory verification.
- Beta35 remains an internal GitHub draft with 12 non-empty digest-bearing assets. The Windows
  installer is 185,856,638 bytes with SHA-256
  `00f2b45e9002de82f73db8a68788aa3fbfd71e89251ee7e469eef90ba270aab4`.
- Windows signing receipt: `channel=prerelease-internal`, `signature=NotSigned`,
  `broadDistributionAllowed=false`. Anonymous release lookup returns HTTP 404.

## Remaining Evidence

- Installed-runtime latency is not claimed until the public commit is exercised in Izzi AI.
- The installed timing method must record fresh-process and warm navigation from the Customer
  Marketing route request until the loading state is gone, while also checking renderer console
  and page errors.
- Beta35 was not installed on the current owner profile. CMR-216 requires an isolated-user or
  clean-machine lifecycle receipt, and the unsigned draft is not authorized for broad distribution.
- CMR-216 remains partial until isolated-user and clean-VM lifecycle receipts exist.
