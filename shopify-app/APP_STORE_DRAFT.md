# App Store listing working draft — do not submit yet

Name: NovaraDesk
Proposed positioning after workspace linking is implemented: customer support workspace with Shopify order context.

Current testable functionality:
- Find recent Shopify orders by order number.
- View payment, fulfilment and total information in Shopify admin.
- Respect the signed-in staff member's order permissions.

Do not claim ticket sync, AI replies, customer profile sync, automatic refunds, historical order access or background sync: these are not implemented by this integration.

Reviewer test sequence after staging is configured:
1. Install on fresh development store, grant read_orders, open in Shopify admin.
2. View recent orders; find a known order number and an absent number.
3. Use a staff account without order permissions and verify access is denied.
4. Reopen after session expiry; test incognito, mobile width and denied consent.
5. Uninstall and verify metadata deletion; reinstall and repeat lookup.
6. Send valid/invalid signed compliance webhooks, retry deliveries and simulate DB failure. Invalid signatures must return 401; DB failure must return retryable 503.

Pending listing assets: actual application screenshots, demo video if required, support contact, privacy URL, pricing, installation guide and validated review account instructions. Never include merchant credentials or tokens in this public file.
