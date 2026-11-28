// The binding must point to an isolated NovaraDesk staging backend. Never accept
// a backend URL, workspace ID, shop, or user identity supplied by the browser.
const json = (body, status = 200) => Response.json(body, {
  status, headers: {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}
});

export async function workspaceRoute(request, env, shop, shopifyOwner, readOrder) {
  if (env.WORKSPACE_LINKING_ENABLED !== 'staging' || !env.WORKSPACE_BACKEND?.fetch)
    return json({error: 'Workspace linking requires an isolated staging backend'}, 503);
  if (!shopifyOwner) return json({error: 'The Shopify store owner must link the workspace'}, 403);
  const session = request.headers.get('x-workspace-session') || '';
  if (!/^novara_[a-f0-9]{64}$/.test(session)) return json({error: 'Sign in to the staging workspace'}, 401);
  const backendGet = path => env.WORKSPACE_BACKEND.fetch(new Request('https://workspace.internal' + path, {
    headers: {authorization: 'Bearer ' + session}, redirect: 'error', signal: AbortSignal.timeout(10000)
  }));
  const auth = await backendGet('/auth/me');
  if (auth.status === 401 || auth.status === 403) return json({error: 'Workspace access denied'}, auth.status);
  if (!auth.ok) return json({error: 'Workspace verification unavailable'}, 502);
  const {user} = await auth.json();
  if (user?.status !== 'active' || user?.role !== 'admin' || !Number.isSafeInteger(user.id) ||
      typeof user.workspace_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(user.workspace_id))
    return json({error: 'An active workspace administrator is required'}, 403);
  const workspace = user.workspace_id;
  let body;
  try { body = await request.json(); } catch { return json({error: 'Invalid JSON'}, 400); }
  // Reject identity overrides instead of silently trusting or ignoring them.
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(k => !['ticketId', 'order'].includes(k)))
    return json({error: 'Only ticketId and order are accepted'}, 400);
  const path = new URL(request.url).pathname;
  if (path === '/api/workspace-link') {
    if (Object.keys(body).length) return json({error: 'Workspace linking accepts an empty object'}, 400);
    // A shop cannot be silently reassigned by another workspace. The constraint
    // is enforced in SQL so concurrent requests cannot overwrite each other.
    await env.DB.prepare(`INSERT INTO workspace_links(shop,workspace_id,linked_by)
      VALUES(?,?,?) ON CONFLICT(shop) DO NOTHING`).bind(shop,workspace,user.id).run();
    const link = await env.DB.prepare('SELECT workspace_id FROM workspace_links WHERE shop=?').bind(shop).first();
    if (link?.workspace_id !== workspace) return json({error: 'Store is linked to another workspace'}, 409);
    return json({linked: true, workspace});
  }
  if (!Number.isSafeInteger(body.ticketId) || body.ticketId <= 0 ||
      typeof body.order !== 'string' || !/^#?[0-9]{1,20}$/.test(body.order))
    return json({error: 'A valid ticket ID and order number are required'}, 400);
  const link = await env.DB.prepare('SELECT workspace_id FROM workspace_links WHERE shop=?').bind(shop).first();
  if (link?.workspace_id !== workspace) return json({error: 'Link this store to your workspace first'}, 403);
  const response = await backendGet('/ticket-detail?id=' + body.ticketId);
  if (response.status === 404) return json({error: 'Ticket not found'}, 404);
  if (!response.ok) return json({error: 'Ticket verification unavailable'}, 502);
  const {ticket} = await response.json();
  // Existing production tickets have no workspace_id: fail closed. Never infer
  // ownership from email, a shared numeric ID, or the signed-in user's workspace.
  if (ticket?.id !== body.ticketId || ticket.workspace_id !== workspace)
    return json({error: 'Ticket workspace ownership could not be verified'}, 403);
  const result = await readOrder(body.order);
  if (!result.ok) return result;
  const data = await result.json();
  const number = body.order.replace(/^#/, '');
  const matches = (data.orders || []).filter(o => o.name === '#' + number && /^gid:\/\/shopify\/Order\/[0-9]+$/.test(o.id));
  if (data.shop !== shop || matches.length !== 1) return json({error: 'Exact order not found in this store'}, 404);
  await env.DB.prepare(`INSERT INTO ticket_order_links(shop,workspace_id,ticket_id,order_gid,linked_by)
    VALUES(?,?,?,?,?) ON CONFLICT(shop,workspace_id,ticket_id,order_gid) DO NOTHING`)
    .bind(shop,workspace,body.ticketId,matches[0].id,user.id).run();
  return json({linked: true, ticketId: body.ticketId, order: matches[0].name});
}
