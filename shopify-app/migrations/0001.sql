-- Metadata only. Never persist order/customer payloads or access tokens here.
CREATE TABLE IF NOT EXISTS shops (shop TEXT PRIMARY KEY, installed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_receipts (
 shop TEXT NOT NULL, id TEXT NOT NULL, topic TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(shop,id)
);
