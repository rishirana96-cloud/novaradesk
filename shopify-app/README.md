# NovaraDesk Shopify staging integration

Separate embedded app service. Does not import, modify, call, or deploy the live index.html, test2.0.html or novara-cx-ai Worker. Do not merge this branch or deploy the existing Pages project as part of Shopify testing.

## Implemented scope

Read-only recent-order context inside Shopify admin. Managed installation, App Bridge ID tokens validated server-side, per-request online token exchange enforcing staff permissions, bounded GraphQL order queries, no access tokens/customer payloads persisted. D1 stores shop domain/install timestamp and webhook receipt metadata only. Privacy customer requests have no stored customer data to export or erase; shop redaction deletes all shop metadata. These statements cover this isolated service only, not production NovaraDesk.

## Local verification

Requires Node 22+. `npm test` and `npm run check`. No packages required for tests. Tests use controlled Shopify HTTP and D1 doubles; they do not prove Shopify installation, real API schema behavior, actual D1 transactions, App Bridge browser behavior or review acceptance.

## Staging setup (never use production identifiers)

1. Create/select a Shopify development app and dev store in Novara CX. Obtain client ID and authorize secret use through a secure runtime configuration flow. Never paste secrets into GitHub, source files, command arguments or logs.
2. Provision a NEW Worker named `novaradesk-shopify-staging` and NEW D1 database. Copy `wrangler.toml.example` to an ignored/local configuration and replace the database ID and client ID. Add SHOPIFY_API_SECRET through the hosting secret store. Do not use production NovaraDesk's database, routes or Worker name.
3. Apply migrations/0001.sql to that database and deploy this directory only using official Cloudflare tooling. This repository has no deployment workflow. DNS changes are not required for staging.
4. Copy shopify.app.toml.example to a local Shopify CLI config, insert actual client ID/staging HTTPS URL, and register the version with Shopify CLI. Managed installation must remain enabled (do not enable legacy install flow). The callback entry is configuration only: this service uses token exchange, not OAuth authorization-code callbacks.
5. Install exclusively on a development store, authorize read_orders, and request applicable protected customer data access through Shopify. No read_customers, write scopes or read_all_orders requested.
6. Open app from admin. Verify ID-token authentication, order lookup, permission denial for restricted staff, empty store, expired sessions and reinstall. Verify all webhooks with Shopify-signed deliveries against the real D1 database.

Online access tokens are deliberate: this version acts only when a staff member opens it. Background order sync is not implemented. If added later, use expiring offline tokens and encrypted token/refresh-token storage.

## Privacy operations

No request or response body logging. Do not enable observability that captures authorization headers, webhook bodies, access-token responses or order data. Implement host-level rate limiting before public launch. Retain webhook receipt metadata only as necessary (proposed 30 days); configure a scheduled deletion job before public launch. Customer data request replies must be delivered through the merchant's established privacy process; this service records receipt without customer payloads.

## Launch gates — not submission ready

- Shopify account authorization, app registration/credentials and test installation.
- Separate HTTPS runtime and D1 staging deployment, real signed webhook and reinstall tests.
- Secure tenant-aware workspace account linking and ticket/order context integration with the production backend source, which is not in these two GitHub repositories. Do not link by an unverified shop query parameter or email match.
- Published app-specific privacy/support/deletion information with verified business contact details.
- Decide actual pricing. No billing or external checkout is implemented; don't advertise paid plans before Shopify billing is implemented/tested.
- Listing screenshots from actual dev-store behavior, reviewer instructions and current automated Shopify checks.
- Final user approval before App Store submission.

The current service is an isolated integration foundation, not a complete replacement for the NovaraDesk ticketing product.

Official references checked 2026-10-31:
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange
- https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
