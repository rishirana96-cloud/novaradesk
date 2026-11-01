import {privacyResponse} from './privacy.js';
// Staging boundary: never bind the production D1 database or use a real sender.
export const schema = `CREATE TABLE IF NOT EXISTS wa_inbound (
 id TEXT PRIMARY KEY, sender TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'received',
 reply TEXT, lease INTEGER NOT NULL DEFAULT 0, outbound_id TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wa_statuses (
 message_id TEXT, status TEXT, event_time TEXT,
 PRIMARY KEY(message_id,status,event_time));`;
const encoder = new TextEncoder();
export async function validSignature(raw, signature, secret) {
 if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
 const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes = Uint8Array.from(signature.slice(7).match(/../g),v=>parseInt(v,16));
 return crypto.subtle.verify('HMAC',key,bytes,encoder.encode(raw));
}
export function createHandler(backend, graphFetch = fetch) {
 async function send(env, to, text) {
  if (!String(env.WHATSAPP_TEST_RECIPIENTS || '').split(',').includes(to)) throw new Error('Recipient blocked');
  if (!env.META_ACCESS_TOKEN) throw new Error('Token not configured');
  const response = await graphFetch(`https://graph.facebook.com/v25.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.META_ACCESS_TOKEN}`},
   body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:text.slice(0,4000)}})
  });
  const result = await response.json();
  if (!response.ok || !result.messages?.[0]?.id) throw new Error('WhatsApp delivery request failed');
  return result.messages[0].id;
 }
 return {async fetch(request,env,ctx) {
  try { env={...env,...JSON.parse(env.WHATSAPP_STAGING_CONFIG || '{}')}; }
  catch { return new Response('Invalid staging configuration',{status:503}); }
  const url=new URL(request.url);
  if (request.method==='GET' && ['/privacy','/data-deletion'].includes(url.pathname)) return privacyResponse(url.pathname);
  if (env.APP_ENV !== 'whatsapp-staging') return new Response('Staging configuration required',{status:503});
  if (url.pathname !== '/webhooks/meta') return backend.fetch(request,env,ctx);
  if (request.method==='GET') {
   const ok=env.META_VERIFY_TOKEN && url.searchParams.get('hub.mode')==='subscribe' && url.searchParams.get('hub.verify_token')===env.META_VERIFY_TOKEN;
   return new Response(ok ? url.searchParams.get('hub.challenge') || '' : 'Forbidden',{status:ok?200:403});
  }
  if (request.method!=='POST') return new Response('Method not allowed',{status:405});
  const raw=await request.text();
  if (encoder.encode(raw).length>1024*1024) return new Response('Payload too large',{status:413});
  if (!await validSignature(raw,request.headers.get('x-hub-signature-256'),env.META_APP_SECRET)) return new Response('Forbidden',{status:403});
  let payload; try {payload=JSON.parse(raw);} catch {return new Response('Invalid JSON',{status:400});}
  if (payload.object!=='whatsapp_business_account') return new Response('Ignored');
  if (!env.DB) return new Response('Staging database required',{status:503});
  for (const sql of schema.split(';').map(s=>s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
  try {
   for (const entry of payload.entry || []) {
    if (entry.id!==env.WHATSAPP_BUSINESS_ACCOUNT_ID) continue;
    for (const change of entry.changes || []) {
     const value=change.value || {};
     if (change.field!=='messages' || value.metadata?.phone_number_id!==env.WHATSAPP_PHONE_NUMBER_ID) continue;
     for (const status of value.statuses || []) {
      if (status.id && status.status && status.timestamp) await env.DB.prepare('INSERT OR IGNORE INTO wa_statuses VALUES (?,?,?)').bind(status.id,status.status,status.timestamp).run();
     }
     for (const message of value.messages || []) {
      if (!message.id || !/^\d{7,15}$/.test(message.from || '') || !String(env.WHATSAPP_TEST_RECIPIENTS || '').split(',').includes(message.from)) continue;
      if (message.type!=='text' || !message.text?.body) continue; // Media requires a separate ingestion path.
      await env.DB.prepare('INSERT OR IGNORE INTO wa_inbound (id,sender) VALUES (?,?)').bind(message.id,message.from).run();
      let row=await env.DB.prepare('SELECT * FROM wa_inbound WHERE id=?').bind(message.id).first();
      if (row.state==='done') continue;
      const claim=await env.DB.prepare("UPDATE wa_inbound SET lease=? WHERE id=? AND lease<? AND state!='done'").bind(Date.now()+60000,message.id,Date.now()).run();
      if (!claim.meta.changes) throw new Error('Message already processing');
      try {
       if (!row.reply) {
        const response=await backend.fetch(new Request(new URL('/',request.url),{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Novara-WhatsApp-Staging'},body:JSON.stringify({message:message.text.body,sessionId:`whatsapp_${message.from}`})}),env,ctx);
        const data=await response.json();
        if (!response.ok || !data.reply) throw new Error('Staging backend failed');
        row.reply=String(data.reply).replace(/\[CSAT\]/g,'').trim();
        await env.DB.prepare("UPDATE wa_inbound SET reply=?,state='replied' WHERE id=?").bind(row.reply,message.id).run();
       }
       const outboundId=await send(env,message.from,row.reply);
       await env.DB.prepare("UPDATE wa_inbound SET state='done',outbound_id=?,lease=0 WHERE id=?").bind(outboundId,message.id).run();
      } catch(error) {
       await env.DB.prepare('UPDATE wa_inbound SET lease=0 WHERE id=?').bind(message.id).run();
       throw error;
      }
     }
    }
   }
   return new Response('EVENT_RECEIVED');
  } catch {return new Response('Temporary processing failure',{status:503});}
 }};
}
