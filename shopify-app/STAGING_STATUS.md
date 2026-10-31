# Shopify staging status — 2026-10-31

- Shopify organization: Novara CX, 236937926
- Shopify app: NovaraDesk, 442231881729
- Development version: staging-integration, 1189354733569 (active configuration; NOT an App Store submission)
- Client ID: 817075945a261da7fc413a19b6582220 (public identifier)
- Worker: novaradesk-shopify-staging
- URL: https://novaradesk-shopify-staging.rishi-rana96.workers.dev/
- Deployed code version initially verified: 7616cb71 (runtime updates can create newer versions)
- D1 database: novaradesk-shopify-staging, 457e7df7-46a0-446f-92bd-6f2ca580a26e
- Tables shops and webhook_receipts created successfully through D1 console.
- DB binding confirmed to the staging database only.
- SHOPIFY_API_KEY and SHOPIFY_API_VERSION configured on staging Worker.
- SHOPIFY_API_SECRET remains pending secure authorization/transfer from the new Shopify app to Cloudflare's encrypted Worker secret store.
- Shopify version currently has read_orders and the staging URL. Compliance subscriptions still need registration from shopify.app.staging.toml; they are not configured by the dashboard creation form.
- No dev-store installation or live Shopify order test yet. No production application changes.

Next: authorize secure Shopify secret transfer, install on development store, register compliance webhooks, run real integration tests, and implement tenant-safe NovaraDesk workspace linking before review.
