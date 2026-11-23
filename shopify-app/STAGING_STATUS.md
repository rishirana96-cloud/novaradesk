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
- SHOPIFY_API_SECRET saved and confirmed as Value encrypted on the staging Worker after user authorization. No secret committed.
- Health endpoint returned service novaradesk-shopify, status ok. Standalone app loads and refuses unauthenticated access.
- Development store NovaraDesk Staging created with Shopify-generated test data: novaradesk-staging.myshopify.com.
- User authorized installation; NovaraDesk successfully installed on NovaraDesk Staging and opens embedded in Shopify admin.
- First embedded order request returned 503. Identified Cloudflare ExecutionContext incorrectly passed as the injected fetch client. Fixed module entry point and added regression test; all 26 tests pass.
- Fixed source is in the draft PR; deployment of the fix is pending because the connected browser timed out opening the staging code editor. No successful live order lookup claimed.
- Shopify version currently has read_orders and the staging URL. Compliance subscriptions still need registration from shopify.app.staging.toml; they are not configured by the dashboard creation form.
- Development-store installation complete. Live order lookup not yet passing. No production application changes.

Next: deploy the Worker entry-point fix to staging, verify embedded order lookup, register compliance webhooks, run real integration tests, and implement tenant-safe NovaraDesk workspace linking before review.

## Retest — 2026-11-23

- Checked branch 6a5c69d without merging or deploying production changes.
- Existing 26 tests and syntax check passed under Node 24.22.3.
- Added 10 readiness tests. All 36 tests pass. New coverage includes empty order results, upstream 429/outages/malformed results, uncached responses, duplicate privacy webhook delivery, cross-shop receipt IDs, targeted uninstall and transactional shop redaction. SQLite is local/in-memory through a D1 adapter; this does not prove remote D1 behavior.
- Signed into existing Shopify account and opened the existing development store and embedded NovaraDesk app.
- Embedded app loads and displays `Shopify could not return orders. Check app access approval.` No successful live order lookup claimed.
- Shopify Dev Dashboard logs show the Orders GraphQL request with ERR status. Detail panel remained loading, so the exact underlying GraphQL error message was unavailable.
- Verified Protected customer data access page: Level 1 Customer data is Not requested. This is a confirmed unmet prerequisite and a likely explanation for the failed lookup. Level 2 names, email, phone and addresses are also Not requested; the implemented order query does not need those fields.
- Opened Customer data access reasons dialog. Customer service is available. No permissions saved or expanded. Awaiting explicit approval before enabling Level 1 development access.
- End-to-end order lookup and update tests remain blocked. Workspace linking, ticket context, AI order lookup and background order sync are not implemented in this isolated service.

### Approved development access and successful live test

- User explicitly approved enabling Level 1 development customer data access for Customer service. Applied and saved through Shopify Dev Dashboard. Names, email addresses, phone numbers and addresses remain unrequested.
- Existing development order #1001 retrieved successfully with payment PENDING, fulfilment UNFULFILLED and total USD 10.00.
- Searching a nonexistent order returned 0 orders. Invalid text returned Enter a numeric order number.
- Created development-only free order #1002 from draft #D12, containing NovaraDesk QA — zero-value fulfilment test. No customer, tax, shipping or monetary payment required.
- Embedded app retrieved #1002 as PAID / UNFULFILLED / USD 0.00.
- Marked this synthetic order fulfilled in Shopify. Confirmed Shopify rendered Fulfilled #1002-F1, then refreshed the embedded order lookup and confirmed PAID / FULFILLED / USD 0.00.
- This verifies live on-demand read-only order retrieval and visibility of fulfilment updates. It does not verify webhook-driven sync, ticket linkage, AI order lookup, restricted-staff behavior, uninstall/reinstall or public-app approval. Those remain separate launch gates.
- No production application deployment or production data changes made. The free order is retained in the development store as test evidence.
