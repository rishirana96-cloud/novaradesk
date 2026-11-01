import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createHandler} from '../src/connector.js';
import deployedWorker from '../dist/worker.js';
function setup() {
 const sqlite=new DatabaseSync(':memory:');
 const DB={exec:async sql=>sqlite.exec(sql),prepare(sql){let args=[];return {bind(...values){args=values;return this;},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},async all(){return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
 const env={APP_ENV:'whatsapp-staging',META_VERIFY_TOKEN:'verify',META_APP_SECRET:'secret',META_ACCESS_TOKEN:'token',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_BUSINESS_ACCOUNT_ID:'456',WHATSAPP_TEST_RECIPIENTS:'919999999999',DB};
 let calls=0,sends=0,fail=false;
 const handler=createHandler({async fetch(){calls++;return Response.json({reply:'Test receipt [CSAT]'});}},async(url,init)=>{sends++;assert.equal(url,'https://graph.facebook.com/v25.0/123/messages');assert.equal(JSON.parse(init.body).text.body,'Test receipt');return fail ? Response.json({error:{}},{status:500}) : Response.json({messages:[{id:'outbound'}]});});
 const message=id=>({id,from:'919999999999',type:'text',text:{body:'hello'}});
 const payload=(messages=[message('a')])=>({object:'whatsapp_business_account',entry:[{id:'456',changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages}}]}]});
 const post=async(data,signature=true)=>{const raw=JSON.stringify(data);return handler.fetch(new Request('https://staging.invalid/webhooks/meta',{method:'POST',headers:{'x-hub-signature-256':signature?'sha256='+createHmac('sha256','secret').update(raw).digest('hex'):'bad'},body:raw}),env,{});};
 return {env,handler,message,payload,post,stats:()=>({calls,sends}),setFailure:v=>fail=v};
}
test('challenge requires matching verification token and staging environment',async()=>{const t=setup();let r=await t.handler.fetch(new Request('https://staging.invalid/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=hello'),t.env);assert.equal(await r.text(),'hello');r=await t.handler.fetch(new Request('https://staging.invalid/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong'),t.env);assert.equal(r.status,403);t.env.APP_ENV='production';assert.equal((await t.post(t.payload())).status,503);});
test('unsigned payload never reaches backend',async()=>{const t=setup();assert.equal((await t.post(t.payload(),false)).status,403);assert.deepEqual(t.stats(),{calls:0,sends:0});});
test('all batched text messages processed and redelivery deduplicated',async()=>{const t=setup();const p=t.payload([t.message('a'),t.message('b')]);assert.equal((await t.post(p)).status,200);assert.equal((await t.post(p)).status,200);assert.deepEqual(t.stats(),{calls:2,sends:2});});
test('wrong WABA, phone ID, recipient, and non-text are ignored',async()=>{const t=setup();let p=t.payload();p.entry[0].id='other';await t.post(p);p=t.payload();p.entry[0].changes[0].value.metadata.phone_number_id='other';await t.post(p);p=t.payload([{...t.message('b'),from:'918888888888'},{...t.message('c'),type:'image'}]);await t.post(p);assert.deepEqual(t.stats(),{calls:0,sends:0});});
test('Graph failure retries cached response without another backend call',async()=>{const t=setup();t.setFailure(true);assert.equal((await t.post(t.payload())).status,503);t.setFailure(false);assert.equal((await t.post(t.payload())).status,200);assert.deepEqual(t.stats(),{calls:1,sends:2});});
test('delivery status callbacks stored without generating replies',async()=>{const t=setup();const p=t.payload([]);p.entry[0].changes[0].value.statuses=[{id:'outbound',status:'delivered',timestamp:'1'}];await t.post(p);await t.post(p);assert.deepEqual(t.stats(),{calls:0,sends:0});assert.equal((await t.env.DB.prepare('SELECT COUNT(*) AS n FROM wa_statuses').first()).n,1);});

test('bundled NovaraDesk backend records staging receipt in isolated database',async()=>{const t=setup();const response=await deployedWorker.fetch(new Request('https://staging.invalid/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Hello integration test',sessionId:'whatsapp_test'})}),{...t.env,WHATSAPP_TEST_MODE:'receipt'});assert.equal(response.status,200);const data=await response.json();assert.match(data.reply,/NovaraDesk staging/);const logged=await t.env.DB.prepare('SELECT session_id, user_message FROM chat_logs').first();assert.equal(logged.session_id,'whatsapp_test');assert.equal(logged.user_message,'Hello integration test');});
