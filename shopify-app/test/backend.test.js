import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {handleWorkspace,hash,verifyGoogle} from '../workspace-backend/worker.js';
import {workspaceRoute} from '../src/workspace.js';

const origin='https://workspace.example',shop='demo.myshopify.com';
const session='novara_'+'a'.repeat(64),otherSession='novara_'+'b'.repeat(64);
const now=Math.floor(Date.now()/1000);
function d1(sqlite){return {prepare(sql){return {bind(...values){return {
 async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
 async first(){return sqlite.prepare(sql).get(...values)||null;},
 async all(){return {results:sqlite.prepare(sql).all(...values)};}
 };}};},async batch(statements){sqlite.exec('BEGIN');try{const results=await Promise.all(statements.map(s=>s.run()));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL('../workspace-backend/migrations/0001.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../workspace-backend/seed.sql',import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO app_users(id,email,role,status,workspace_id) VALUES(2,'beta@example.test','admin','active','staging-beta')");
 sqlite.prepare('INSERT INTO app_sessions VALUES(?,?,?)').run(await hash(session),1,now+3600);
 sqlite.prepare('INSERT INTO app_sessions VALUES(?,?,?)').run(await hash(otherSession),2,now+3600);
 return {sqlite,env:{DB:d1(sqlite),GOOGLE_CLIENT_ID:'staging-client'}};
}
function req(path,token=session,method='GET',body,headers={}){return new Request(origin+path,{method,headers:{authorization:'Bearer '+token,...(method==='POST'?{origin,'content-type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('staging backend validates actual hashed sessions and hides cross-workspace tickets',async()=>{
 const {env}=await fixture();
 assert.equal((await handleWorkspace(req('/auth/me'),env)).status,200);
 assert.equal((await handleWorkspace(req('/ticket-detail?id=10001'),env)).status,200);
 assert.equal((await handleWorkspace(req('/ticket-detail?id=20001'),env)).status,404);
 assert.equal((await handleWorkspace(req('/ticket-detail?id=20001',otherSession),env)).status,200);
 const list=await (await handleWorkspace(req('/tickets'),env)).json();assert.deepEqual(list.tickets.map(t=>t.id),[10001]);
 assert.equal((await handleWorkspace(req('/auth/me','novara_'+'c'.repeat(64)),env)).status,401);
});
test('blocked users and expired sessions lose ticket access',async()=>{
 const {env,sqlite}=await fixture();sqlite.exec("UPDATE app_users SET status='blocked' WHERE id=1");
 assert.equal((await handleWorkspace(req('/ticket-detail?id=10001'),env)).status,401);
 sqlite.exec("UPDATE app_users SET status='active' WHERE id=1; UPDATE app_sessions SET expires_at=1");
 assert.equal((await handleWorkspace(req('/auth/me'),env)).status,401);
});
test('ticket IDs cannot inject SQL or override workspace filters',async()=>{
 const {env}=await fixture();
 assert.equal((await handleWorkspace(req('/ticket-detail?id=10001%20OR%201=1'),env)).status,400);
 assert.equal((await handleWorkspace(req('/ticket-detail?id=20001&workspace_id=staging-beta'),env)).status,404);
});
test('handoff codes are shop-bound, one-use, expiring, and never stored raw',async()=>{
 const {env,sqlite}=await fixture();
 const issued=await (await handleWorkspace(req('/auth/handoff',session,'POST',{shop}),env)).json();
 assert.match(issued.code,/^[a-f0-9]{64}$/);
 assert.notEqual(sqlite.prepare('SELECT code_hash FROM handoff_codes').get().code_hash,issued.code);
 const exchange=(code,store=shop)=>handleWorkspace(req('/auth/handoff/exchange','', 'POST',{code,shop:store}),env);
 assert.equal((await exchange(issued.code,'other.myshopify.com')).status,401);
 const redeemed=await exchange(issued.code);assert.equal(redeemed.status,200);
 const {token}=await redeemed.json();assert.match(token,/^novara_[a-f0-9]{64}$/);
 assert.equal((await handleWorkspace(req('/auth/me',token),env)).status,200);
 assert.equal((await exchange(issued.code)).status,401);
 const expired=await (await handleWorkspace(req('/auth/handoff',session,'POST',{shop}),env)).json();
 sqlite.exec('UPDATE handoff_codes SET expires_at=1');assert.equal((await exchange(expired.code)).status,401);
});
test('cross-origin mutation cannot mint a connection code',async()=>{
 const {env}=await fixture();assert.equal((await handleWorkspace(req('/auth/handoff',session,'POST',{shop},{origin:'https://evil.test'}),env)).status,403);
});
test('real SQLite linking succeeds only for the verified workspace ticket',async()=>{
 const {env}=await fixture();const links=new DatabaseSync(':memory:');links.exec('PRAGMA foreign_keys=ON');
 links.exec(readFileSync(new URL('../migrations/0002_workspace_links.sql',import.meta.url),'utf8'));
 const linking={DB:d1(links),WORKSPACE_LINKING_ENABLED:'staging',WORKSPACE_BACKEND:{fetch:r=>handleWorkspace(r,env)}};
 const linkReq=(path,body)=>new Request('https://shopify.example'+path,{method:'POST',headers:{'x-workspace-session':session},body:JSON.stringify(body)});
 const readOrder=async()=>Response.json({shop,orders:[{id:'gid://shopify/Order/2',name:'#1002'}]});
 assert.equal((await workspaceRoute(linkReq('/api/workspace-link',{}),linking,shop,true,readOrder)).status,200);
 assert.equal((await workspaceRoute(linkReq('/api/ticket-order-link',{ticketId:10001,order:'1002'}),linking,shop,true,readOrder)).status,200);
 assert.equal((await workspaceRoute(linkReq('/api/ticket-order-link',{ticketId:20001,order:'1002'}),linking,shop,true,readOrder)).status,404);
 assert.equal(links.prepare('SELECT count(*) n FROM ticket_order_links').get().n,1);
 assert.equal(links.prepare('SELECT workspace_id FROM ticket_order_links').get().workspace_id,'staging-alpha');
});
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key'};
const keyFetch=async()=>Response.json({keys:[jwk]});
function credential(overrides={}){const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const unsigned=b({alg:'RS256',kid:'test-key'})+'.'+b({aud:'staging-client',iss:'https://accounts.google.com',exp:now+300,iat:now,email_verified:true,sub:'google-user-1',email:'rishi.rana96@gmail.com',nonce:'d'.repeat(64),...overrides});
 return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');}
for(const override of [{aud:'production-client'},{nonce:'wrong'},{email_verified:false},{exp:1},{nbf:now+300},{iss:'https://evil.test'}])test('Google verifier rejects '+JSON.stringify(override),async()=>{
 await assert.rejects(verifyGoogle(credential(override),'staging-client','d'.repeat(64),keyFetch));
});
test('Google sign-in consumes nonce, sets HttpOnly staging cookie, and prevents replay',async()=>{
 const {env,sqlite}=await fixture();const nonce='d'.repeat(64);
 sqlite.prepare('INSERT INTO login_challenges VALUES(?,?)').run(await hash(nonce),now+300);
 const login=()=>handleWorkspace(req('/auth/google','', 'POST',{credential:credential()},{cookie:'__Host-staging-nonce='+nonce}),env,keyFetch);
 const res=await login();assert.equal(res.status,200);assert.match(res.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);
 assert.equal((await res.json()).token,undefined);assert.equal((await login()).status,401);
});
