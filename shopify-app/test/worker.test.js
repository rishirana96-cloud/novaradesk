import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {authenticate,handle} from '../src/worker.js';
const calls=[];
const DB={prepare(sql){return{bind(...values){return{sql,values,run:async()=>{calls.push({sql,values})}}}}},batch:async s=>{calls.push(...s)}};
const env={SHOPIFY_API_KEY:'testkey',SHOPIFY_API_SECRET:'testsecret',SHOPIFY_API_VERSION:'2026-10',DB};
function jwt(overrides={},secret=env.SHOPIFY_API_SECRET,header={alg:'HS256'}){
 const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const now=Math.floor(Date.now()/1000);const p=b(header)+'.'+b({aud:env.SHOPIFY_API_KEY,exp:now+60,nbf:now-1,sub:'1',dest:'https://demo.myshopify.com',iss:'https://demo.myshopify.com/admin',...overrides});
 return p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
}
const req=(path,token=jwt())=>new Request('https://staging.example'+path,{headers:{authorization:'Bearer '+token}});
test('valid session yields signed tenant',async()=>assert.equal(await authenticate(jwt(),env),'demo.myshopify.com'));
for(const [name,claims,secret,header] of [
 ['expired',{exp:1}],['future',{nbf:Date.now()/1000+3600}],['audience',{aud:'other'}],['cross tenant issuer',{iss:'https://other.myshopify.com/admin'}],['SSRF',{dest:'https://evil.test',iss:'https://evil.test/admin'}],['bad issuer path',{iss:'https://demo.myshopify.com/evil'}],['signature',{},'wrong'],['algorithm',{},undefined,{alg:'none'}],['missing expiry',{exp:null}],['credentials',{dest:'https://user@demo.myshopify.com'}]
])test('reject '+name,async()=>{await assert.rejects(authenticate(jwt(claims,secret,header),env),e=>e.status===401)});
test('unauthenticated request cannot reach upstream',async()=>{let reached=false;const r=await handle(req('/api/orders','bad'),env,()=>{reached=true});assert.equal(r.status,401);assert.equal(reached,false)});
test('query shop cannot override signed tenant; no access token in response',async()=>{
 const seen=[];const response=await handle(req('/api/orders?shop=evil.myshopify.com&order=1001'),env,async(url,init)=>{
 seen.push({url,init});return Response.json(seen.length===1?{access_token:'never-expose',associated_user_scope:'read_orders'}:{data:{orders:{nodes:[{name:'#1001'}]}}});
 });assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes('never-expose'));assert.ok(seen.every(x=>x.url.startsWith('https://demo.myshopify.com/')));assert.equal(JSON.parse(seen[1].init.body).variables.query,'name:1001');assert.equal(new URLSearchParams(seen[0].init.body).get('requested_token_type'),'urn:shopify:params:oauth:token-type:online-access-token');
});
test('reject query injection',async()=>assert.equal((await handle(req('/api/orders?order=name:foo'),env)).status,400));
test('enforces staff scope',async()=>assert.equal((await handle(req('/api/orders'),env,async()=>Response.json({access_token:'x',associated_user_scope:'read_products'}))).status,403));
test('expired exchange prompts session refresh',async()=>{const r=await handle(req('/api/orders'),env,async()=>new Response('',{status:400}));assert.equal(r.status,401);assert.equal(r.headers.get('X-Shopify-Retry-Invalid-Session-Request'),'1')});
test('GraphQL errors are not reported as success',async()=>{let i=0;assert.equal((await handle(req('/api/orders'),env,async()=>Response.json(++i===1?{access_token:'x',associated_user_scope:'read_orders'}:{errors:[{message:'denied'}]}))).status,502)});
function webhook(topic,signature=true){const body=JSON.stringify({customer:{email:'do-not-store@example.com'}});return new Request('https://staging.example/webhooks',{method:'POST',body,headers:{'x-shopify-shop-domain':'demo.myshopify.com','x-shopify-topic':topic,'x-shopify-webhook-id':'abc','x-shopify-hmac-sha256':signature?createHmac('sha256',env.SHOPIFY_API_SECRET).update(body).digest('base64'):'invalid'}})}
test('invalid webhook signature rejected before persistence',async()=>{calls.length=0;assert.equal((await handle(webhook('shop/redact',false),env)).status,401);assert.equal(calls.length,0)});
for(const topic of ['app/uninstalled','customers/redact','customers/data_request','shop/redact'])test('handles '+topic+' without storing payload',async()=>{calls.length=0;assert.equal((await handle(webhook(topic),env)).status,200);assert.ok(!JSON.stringify(calls).includes('do-not-store'));if(topic==='shop/redact')assert.equal(calls.filter(c=>c.sql.startsWith('DELETE')).length,2)});
test('database failure asks Shopify to retry',async()=>{assert.equal((await handle(webhook('customers/redact'),{...env,DB:{batch:async()=>{throw Error('down')}}})).status,503)});
test('HTML CSP is tenant specific and prevents injection',async()=>{const r=await handle(req('/?shop=demo.myshopify.com'),env);assert.ok(r.headers.get('content-security-policy').includes('frame-ancestors https://admin.shopify.com https://demo.myshopify.com'));assert.ok((await r.text()).includes('cdn.shopify.com/shopifycloud/app-bridge.js'))});
test('missing config fails closed',async()=>assert.equal((await handle(req('/'),{})).status,503));
