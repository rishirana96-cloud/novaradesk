# Staging workspace and ticket linking

Implemented, disabled by default, and not deployed. The existing embedded order
lookup continues independently. No production Worker or database was changed.

POST /api/workspace-link accepts `{}`. POST /api/ticket-order-link accepts
`{"ticketId":42,"order":"1002"}`. Both require the current Shopify App Bridge
token as Authorization Bearer and a Novara staging session in x-workspace-session.
Do not paste sessions into a terminal, URL, screenshot, log, or support message.
The connection UI and session handoff are not implemented yet.

The server verifies the Shopify store owner through online token exchange and
checks that the returned user matches the signed Shopify session. It verifies
the Novara administrator and workspace through an explicit backend service
binding. Browser-supplied identity overrides are rejected. A store cannot be
reassigned to another workspace by an upsert. Ticket linking rechecks both
identities and ticket ownership and resolves an exact order in the signed store.
Only link identifiers are stored, without session tokens or order payloads.
Uninstall and shop redaction remove link metadata in the webhook transaction.

## Required staging backend contract

Enable only after applying migration 0002 to the separate Shopify staging D1,
binding WORKSPACE_BACKEND to a separate NovaraDesk staging Worker, and setting
WORKSPACE_LINKING_ENABLED to staging. Do not bind the production Novara backend.

The backend must authenticate sessions and return:

- GET /auth/me: `{ "user": { "id": 7, "role": "admin", "status": "active", "workspace_id": "alpha" } }`
- GET /ticket-detail?id=42: `{ "ticket": { "id": 42, "workspace_id": "alpha" } }`

The ticket route must also enforce workspace ownership in its own SQL. Returning
a workspace ID without enforcing it is not a complete backend tenancy migration.

Read-only inspection on 2026-11-28 found that the production backend has
app_users.workspace_id, but its tickets schema has no workspace_id and its
ticket-detail route queries by ticket ID alone. This implementation deliberately
rejects those ticket responses. Do not infer ticket ownership from the signed-in
user, email, query parameters, or numeric ticket ID. Existing ticket ownership
must be established explicitly before any backfill or production migration.

## Validation and remaining work

43 local tests cover existing authentication and webhook behavior plus staged
linking, owner identity mismatch, workspace/session denial, cross-workspace
tickets, missing ticket ownership, identity overrides, exact order resolution,
metadata-only writes, and uninstall cleanup. Local doubles do not prove real
service bindings, Shopify exchange response shape, or live D1 behavior.

Remaining: isolated backend with tenant-scoped tickets; secure connection UI;
live two-workspace negative tests; signed webhook cleanup tests against D1;
staging deployment. AI order lookup and automatic order syncing are not enabled.
No offline tokens or order-update subscriptions are introduced by this change.
