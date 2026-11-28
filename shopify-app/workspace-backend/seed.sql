-- New staging database only. No production data, sessions, or customer records.
INSERT OR IGNORE INTO app_users(id,email,role,status,workspace_id)
 VALUES(1,'rishi.rana96@gmail.com','admin','active','staging-alpha');
INSERT OR IGNORE INTO tickets(id,workspace_id,subject)
 VALUES(10001,'staging-alpha','Synthetic Shopify order test');
INSERT OR IGNORE INTO tickets(id,workspace_id,subject)
 VALUES(20001,'staging-beta','Synthetic workspace isolation test');
