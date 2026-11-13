# Customer Care shadow workspace — beta.105

Izzi AI adds a Customer Care tab to Agent Marketing. An operator can save merchant knowledge, test a sales conversation and prepare a reply or Sale handoff. This version produces drafts for review. It does not connect a Page, send a customer message, place a call or record a lead/conversion.

## Operator workflow

1. Open Agent Marketing → Chăm sóc khách hàng in the intended workspace.
2. Enter the merchant name, reference Page and Sale handoff recipient. A typed Page ID remains unverified.
3. Add product, price, quality and policy facts with a source and approval date. Review each fact before approving it. Add an expiry where the statement is time sensitive.
4. Save the configuration. Main rechecks authenticated workspace membership; only owners and managers can save setup. Secure OS storage must be available.
5. Test with synthetic conversations. The permission selector represents operator-supplied test state; it is not a customer permission receipt.
6. Review the draft, selected fact IDs, outstanding questions and next action. Take any real customer action in the existing approved sales process.

## Draft behavior

- Answer known questions using active approved facts. Do not condition a known price on the customer supplying a phone number.
- Answer first, then optionally offer a useful phone/Zalo follow-up once. Respect a refusal and avoid repeating a previous contact offer.
- Treat a phone-formatted value as contact presence only. Email alone never enables calling or Zalo. Calling and Zalo permissions remain separate; a call-only selection does not grant Zalo permission.
- Explain price differences only through relevant verified configuration and quality statements. If the product or specification is ambiguous, clarify it.
- Retain redacted excerpts of unresolved customer questions in a handoff draft. One shipping policy does not count as answering a separate warranty question. A draft is not evidence that Sale received it.
- The model selects fact IDs; its free-form prose is never shown. Invalid selections, unavailable inference or a selection that takes over 15 seconds use the rules fallback. A timed-out provider request may still finish in the background, but its late output is ignored. Exact approved text can still be wrong or stale, so merchant review remains necessary.

## Storage and scope

Merchant setup is encrypted with Electron safeStorage and partitioned by authenticated identity and workspace. The assistant does not persist conversation text or contact values, invoke tools, capture a Graph session, or emit analytics events. Model fact selection uses the configured IzziAPI inference route; contact patterns are redacted before selection. This does not imply every kind of personal data can be automatically detected or removed.

Customer Care does not enable the existing generic marketing executor or bypass its gates. A later live connector requires independently verified Page ownership, credential scope, inbound authenticity, durable processing, human takeover and send-result reconciliation.

## Hoàng Hưng setup

The merchant template supplies only the requested display name. It supplies no prices, warranty, quality claims, address or product catalogue from another merchant.

The connected Pancake dashboard currently lists `Đồng Thờ Hồng Hưng` (Page `105252511858057`). Its relationship to the requested `Đồ Đồng Hoàng Hưng` is awaiting owner confirmation. Do not bind the Page or import merchant facts based on name similarity.

All release setup scenarios are synthetic and excluded from production outcomes. A successful shadow test must not be described as a live Page connection or an automated customer-service deployment.

## Validation and known limitations

The independent pre-package checks passed: the full desktop suite (`pnpm --filter @openclaw/desktop test`), workspace lint, renderer typecheck, production build, release/bundle/integrity contracts and signing-policy checks. Playwright exercised the renderer with a synthetic API at desktop and compact widths; those results alone do not prove the native service or a Page connection.

No dependency versions changed. The dependency audit retains the existing baseline of 1 critical, 49 high, 47 moderate and 8 low findings. The critical shell-quote advisory is on the development-only concurrently path; release commands do not use it or pass feature input to a shell. Other existing advisories still require a separate compatibility review. This beta does not claim a clean vulnerability audit.
