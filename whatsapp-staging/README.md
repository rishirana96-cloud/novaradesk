# NovaraDesk WhatsApp Cloud API staging

This branch does not change index.html, the live Worker, production database, DNS, or live channel configuration.

Meta app: 1194466773146387 (NovaraDesk, unpublished)
Business portfolio: 1665192965334929 (Novara CX)
Test messaging account: 1741223560309143
Test sender ID: 1335495949656590
Test sender: +1 555 143 2291
Staging Worker: novaradesk-whatsapp-staging.rishi-rana96.workers.dev
Callback path: /webhooks/meta

The reference Worker was copied read-only from Cloudflare active version 2a67e72b on 2026-11-01. build.js packages this backend with a hardened WhatsApp boundary. No production AI keys or customer data were copied. `WHATSAPP_TEST_MODE=receipt` substitutes a clearly labelled deterministic integration receipt in the staging copy; it does not validate production AI behavior.

Run `npm run check`, `npm test`, and `npm run build` here. Deploy dist/worker.js only to the named staging Worker. Bind DB only to its separate staging D1 database. Never use novara-cx-db.

Store APP_ENV=whatsapp-staging, WHATSAPP_TEST_MODE=receipt, sender ID, messaging account ID, approved test recipients (comma-separated), META_VERIFY_TOKEN, and META_ACCESS_TOKEN in secret JSON WHATSAPP_STAGING_CONFIG. Store META_APP_SECRET as a separate secret. Do not commit credentials. The temporary token expires and is not suitable for production.

The messages field is subscribed; Meta also automatically added its common account/status fields. The connector processes only messages changes. Verify X-Hub-Signature-256 before processing. Messages are restricted to the configured WABA, sender ID, and approved recipients. Non-text messages are ignored. Batched text messages and status callbacks are supported. D1 stores incoming message IDs and cached replies; retries after an explicit Graph failure reuse the reply. A timeout after Meta accepted a send can still produce a duplicate outbound message on retry (Graph does not provide an exactly-once send guarantee here). A process crash between backend logging and caching the reply can duplicate the conversation log. A durable queue/outbox with dead-letter handling is required before production rollout.

Current validation: seven tests passed, including the bundled backend recording a receipt in an isolated SQLite database. Meta confirmed an outbound hello_world test send to the verified recipient. Callback verification succeeded. A signed dashboard sample webhook reached the deployed staging Worker and returned HTTP 200 (Cloudflare outcome ok, 2026-11-01 16:12 IST). The sample contains placeholder WABA/phone IDs, so it validates transport/signature/database initialization but is deliberately excluded from conversation processing. A real WhatsApp inbound-to-reply round trip is not yet validated: Meta states that unpublished apps receive only dashboard test webhooks. The Meta app remains unpublished. Production activation and a real business sender are outside this staging change.

The user explicitly authorized pushing this staging branch, including the copied backend source, to rishirana96-cloud/novaradesk. This branch is not merged into main and has no production deployment workflow.

## Privacy and deletion notice

Public routes /privacy and /data-deletion describe the isolated receipt-mode test integration and use the existing published business contact rishi@novaracx.com. Eight tests pass. These routes are prepared in source but await staging deployment because the Cloudflare browser editor timed out. Meta publication is currently blocked by its missing privacy-policy URL. No Meta publication or business-number registration has been performed.
