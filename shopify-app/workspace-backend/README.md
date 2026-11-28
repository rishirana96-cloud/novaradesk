# Isolated NovaraDesk workspace backend

This is a small staging backend for Shopify ticket-linking validation, not a clone
or replacement of production NovaraDesk. It uses a separate D1 database and
contains only synthetic ticket content. No production sessions, customer records,
API secrets, or existing ticket ownership are copied.

## Deployed on 2026-11-28

- Worker: novaradesk-workspace-staging
- URL: https://novaradesk-workspace-staging.rishi-rana96.workers.dev/
- D1: novaradesk-workspace-staging, 862faf2e-c31a-446d-a18c-e8d5caa616ee
- DB binding confirmed to that database only.
- Schema applied and synthetic seed executed successfully.
- Live GET /health returned the expected service, status ok, staging true.
- Live unauthenticated GET /ticket-detail?id=10001 denied access.
- Login page loads and reports that staging Google sign-in configuration is required.

The new Shopify WORKSPACE_BACKEND service binding was prepared in Cloudflare but
NOT confirmed saved: the browser connection stalled during service selection.
Do not assume that binding exists. Shopify linking remains disabled; migration
0002 in the Shopify database has not been applied by this change. The existing
Shopify Worker code was not redeployed.

## Authentication and ownership

Sessions are isolated, hashed in D1, expire after one hour, and recheck active
user status on every request. Login uses a Google-signed ID token with audience,
issuer, verified email, expiry, nonce, and RSA signature checks. A five-minute
nonce is stored hashed and consumed once. No unprovisioned Google account is
automatically approved. Sign-in cookies are Secure, HttpOnly, and SameSite=Lax.

The backend resolves workspace identity from the authenticated user. Ticket SQL
filters both ticket ID and workspace ID. Workspace query parameters cannot
override ownership. The seed has ticket 10001 in staging-alpha and 20001 in
staging-beta; only staging-alpha is provisioned for the owner's staging login.
The beta administrator used in tests exists only in the local in-memory test DB.

GET /auth/me and GET /ticket-detail implement the Shopify workspace-linking
contract. GET /tickets returns only the authenticated workspace's test tickets.
The public endpoint never returns ticket data without authentication.

POST /auth/challenge and POST /auth/google implement sign-in. POST /auth/logout
revokes the browser session. POST /auth/handoff mints a random shop-bound code
that lasts 60 seconds. POST /auth/handoff/exchange atomically consumes that code
and creates an isolated session. Raw codes and tokens are never stored in D1.
The connection page sends only the short-lived code to its opener using the
exact Shopify staging origin. The corresponding Shopify receiver UI and code
exchange route are not implemented yet; do not claim the flow is end-to-end.

## Remaining activation work

1. Configure a Google web OAuth client whose authorized JavaScript origin is
   https://novaradesk-workspace-staging.rishi-rana96.workers.dev, then set its
   public client ID as GOOGLE_CLIENT_ID on this new Worker. Do not copy an OAuth
   secret into source. Any new Google account access or authorized-origin change
   must be confirmed when making that account change.
2. Finish and verify WORKSPACE_BACKEND on the Shopify staging Worker only.
3. Add the Shopify-side connection-code receiver/exchange UI and route; keep the
   resulting session in memory. Never ask the user to paste a session token.
4. Reconcile deployed Shopify source with the draft branch before deploying.
5. Apply Shopify migration 0002, enable the staging flag, and run live owner,
   wrong-workspace, expired-session, webhook-cleanup, and reconnect checks.

## Verification

From shopify-app, `npm test` passes 56 tests, including real in-memory SQLite
integration of workspace authentication, scoped ticket SQL, linking constraints,
and one-use code redemption. Generated RSA keys exercise Google signature and
nonce verification without real credentials. Node syntax checking passes.
Shopify API calls are doubled; live Google sign-in and full linking are pending.
