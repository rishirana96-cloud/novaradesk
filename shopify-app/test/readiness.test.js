import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle} from '../src/worker.js';
const secret='local-fixture-secret';
function database(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
 return {db,prepare(sql){return{bind(...args){return{sql,args,run:async()=>db.prepare(sql).run(...args)}}}},async batch(statements){db.exec('BEGIN');try{for(const s of statements)db.prepare(s.sql).run(...s.args);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}};
}
function setup(){return{SHOPIFY_API_KEY:'local-key',SHOPIFY_API_SECRET:secret,SHOPIFY_API_VERSION:'2026-10',DB:database()}}
function token(env,shop='fixture.myshopify.com'){
 const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const data=encode({alg:'HS256'})+'.'+encode({aud:env.SHOPIFY_API_KEY,sub:'1',nbf:now-1,exp:now+60,dest:'https://'+shop,iss:'https://'+shop+'/admin'});
 return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');
}
const orderRequest=env=>new Request('https://fixture.invalid/api/orders',{headers:{authorization:'Bearer '+token(env)}});
const exchange=()=>Response.json({access_token:'fixture-access-token',associated_user_scope:'read_orders'});
function hook(topic,id='fixture-event',shop='fixture.myshopify.com'){
 const body=JSON.stringify({customer:{email:'synthetic@example.invalid'},id:101});
 return new Request('https://fixture.invalid/webhooks',{method:'POST',body,headers:{'x-shopify-shop-domain':shop,'x-shopify-topic':topic,'x-shopify-webhook-id':id,'x-shopify-hmac-sha256':createHmac('sha256',secret).update(body).digest('base64')}});
}
test('empty store returns a successful empty list',async()=>{const env=setup();let i=0;const r=await handle(orderRequest(env),env,async()=>++i===1?exchange():Response.json({data:{orders:{nodes:[]}}}));assert.equal(r.status,200);assert.deepEqual((await r.json()).orders,[]);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM shops').get().n,1)});
test('GraphQL throttling returns a retryable response without storing a shop',async()=>{const env=setup();let i=0;const r=await handle(orderRequest(env),env,async()=>++i===1?exchange():new Response('',{status:429}));assert.equal(r.status,429);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM shops').get().n,0)});
test('upstream network failure returns safe 503',async()=>{const env=setup();const r=await handle(orderRequest(env),env,async()=>{throw Error('internal secret must not leak')});assert.equal(r.status,503);assert.ok(!(await r.text()).includes('internal secret'))});
test('token service outage returns 502',async()=>{const env=setup();const r=await handle(orderRequest(env),env,async()=>new Response('',{status:503}));assert.equal(r.status,502)});
test('malformed API result fails safely',async()=>{const env=setup();let i=0;const r=await handle(orderRequest(env),env,async()=>++i===1?exchange():Response.json({data:{}}));assert.equal(r.status,503)});
test('duplicate privacy event is stored once in actual SQLite',async()=>{const env=setup();for(let i=0;i<2;i++)assert.equal((await handle(hook('customers/data_request'),env)).status,200);const rows=env.DB.db.prepare('SELECT * FROM webhook_receipts').all();assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('synthetic@example.invalid'))});
test('same webhook ID is isolated across stores',async()=>{const env=setup();for(const shop of ['one.myshopify.com','two.myshopify.com'])assert.equal((await handle(hook('customers/redact','same-id',shop),env)).status,200);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM webhook_receipts').get().n,2)});
test('uninstall deletes only the intended store',async()=>{const env=setup();for(const shop of ['fixture.myshopify.com','other.myshopify.com'])env.DB.db.prepare('INSERT INTO shops VALUES(?,?)').run(shop,'2026-11-23');assert.equal((await handle(hook('app/uninstalled'),env)).status,200);assert.deepEqual(env.DB.db.prepare('SELECT shop FROM shops').all().map(r=>r.shop),['other.myshopify.com'])});
test('shop redaction removes shop metadata and receipts atomically',async()=>{const env=setup();env.DB.db.prepare('INSERT INTO shops VALUES(?,?)').run('fixture.myshopify.com','2026-11-23');await handle(hook('customers/redact'),env);assert.equal((await handle(hook('shop/redact'),env)).status,200);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM shops').get().n,0);assert.equal(env.DB.db.prepare('SELECT COUNT(*) n FROM webhook_receipts').get().n,0)});
test('responses disable caching of order context',async()=>{const env=setup();let i=0;const r=await handle(orderRequest(env),env,async()=>++i===1?exchange():Response.json({data:{orders:{nodes:[]}}}));assert.equal(r.headers.get('cache-control'),'no-store')});
