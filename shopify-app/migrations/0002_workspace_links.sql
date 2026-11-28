-- Identifier metadata only; no session tokens or order/customer payloads.
CREATE TABLE workspace_links (
  shop TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  linked_by INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(shop,workspace_id)
);
CREATE TABLE ticket_order_links (
  shop TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  ticket_id INTEGER NOT NULL,
  order_gid TEXT NOT NULL,
  linked_by INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(shop,workspace_id,ticket_id,order_gid),
  FOREIGN KEY(shop,workspace_id) REFERENCES workspace_links(shop,workspace_id)
);
