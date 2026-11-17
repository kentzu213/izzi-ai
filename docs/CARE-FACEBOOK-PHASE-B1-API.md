# Phase B1 API contract (backend ↔ desktop)

All routes live under `https://api.izziapi.com/api/marketing/care/facebook` and use the same authentication, envelope, rate limit and error shape as the Phase A Care routes (`/status`, `/connect`, …):
- `Authorization: Bearer <Supabase JWT>`.
- Every success body is `{ "success": true, ...fields }`.
- Every failure body is `{ "success": false, "error": "<fixed text>", "reason": "<code>" }` with HTTP 400/403/422/502/503.
- The shared per-user limit is 30 requests a minute across all Care routes; going over it returns 429.

## Types

```ts
type CareInboxState = {
  enabled: boolean;            // the Page's webhook subscription is on
  subscribedAt: string | null; // ISO time it was turned on
  lastEventAt: string | null;  // ISO time izzi last stored a customer message for this workspace
};

type CareLeadStatus = 'new' | 'contacted' | 'closed';

type CareLead = {
  id: string;                  // uuid
  pageId: string;              // digits
  customerName: string | null; // Facebook first + last name, when Meta returns it
  phone: string;               // normalized Vietnamese mobile, always /^0[35789]\d{8}$/
  zaloMentioned: boolean;      // the customer wrote "zalo"/"zl" in some message
  status: CareLeadStatus;
  phoneCapturedAt: string;     // ISO, when the customer sent this phone
  lastMessageAt: string;       // ISO, the customer's latest message
  statusChangedAt: string | null;
  recentMessages: { text: string; at: string }[]; // ≤ 3 customer messages, oldest first, text ≤ 500 chars;
                                                  // an attachment-only message has text "[tệp đính kèm]"
};
```

## Routes

| Method & path | Body / query | Who | Success fields |
|---|---|---|---|
| `GET /inbox` | `?workspaceId=<uuid>` | owner, manager, editor | `workspaceId`, `inbox: CareInboxState \| null` (null when no live Page binding) |
| `POST /inbox` | `{ workspaceId, enabled: boolean }` | owner, manager | `workspaceId`, `inbox: CareInboxState` |
| `GET /leads` | `?workspaceId=<uuid>&cursor=<opaque>` | owner, manager, editor | `workspaceId`, `leads: CareLead[]` (≤ 50, newest `phoneCapturedAt` first), `nextCursor: string \| null` |
| `POST /leads/status` | `{ workspaceId, leadId, status: CareLeadStatus }` | owner, manager, editor | `workspaceId`, `lead: CareLead` |

## Failure reasons

| HTTP | `reason` | When |
|---|---|---|
| 400 | `invalid_request` | The request fails validation. |
| 403 | `forbidden` | Not a member, or the role is too low (a viewer gets this on every route). |
| 422 | `page_not_connected` | `POST /inbox` with no active binding. |
| 422 | `lead_not_found` | `POST /leads/status` for an unknown lead or another workspace's lead. |
| 502 | `provider_rejected` / `provider_unavailable` / `provider_timeout` / `invalid_response` | Facebook failed during `POST /inbox`. |
| 503 | `not_configured` | Server missing the Facebook config or the vault. |

## Behaviour notes

- **Lead creation.** Leads are created only from messages the customer sent: echoes are ignored. A later message with a newer phone replaces the phone and reopens a `closed` or `contacted` lead as `new`.
- **Nothing is sent.** No route sends a message to a customer.
- **Phone handling in the desktop client.** The phone appears only in API responses. The client must not persist it or emit it to analytics or logs.
