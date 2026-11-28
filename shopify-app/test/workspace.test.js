import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceRoute} from '../src/workspace.js';
import {handle} from '../src/worker.js';
import {createHmac} from 'node:crypto';

const shop='demo.myshopify.com';
const session='novara_'+'a'.repeat(64);
function setup(options={}) {
 const writes=[],requests=[];
 const user={id:7,status:'active',role:'admin',workspace_id:'alpha',...options.user};
 let linked=options.linked === undefined ? 'alpha' : options.linked;
 const env={WORKSPACE_LINKING_ENABLED:'staging',WORKSPACE_BACKEND:{async fetch(req){
  requests.push({url:req.url,authorization:req.headers.get('authorization')});
  if(new URL(req.url).pathname==='/auth/me') return Response.json({user},{status:options.authStatus||200});
  return Response.json({ticket:{id:42,workspace_id:options.ticketWorkspace === undefined?'alpha':options.ticketWorkspace}},{status:options.ticketStatus||200});
 }},DB:{prepare(sql){return{bind(...values){return{
  async run(){writes.push({sql,values});if(sql.includes('INSERT INTO workspace_links')&&!linked)linked=values[1];},
  async first(){return linked?{workspace_id:linked}:null;}
 }}}}}};
 const request=(body={ticketId:42,order:'1002'},path='/api/ticket-order-link',token=session)=>new Request('https://staging.example'+path,{method:'POST',headers:{'x-workspace-session':token},body:JSON.stringify(body)});
 let lookups=0;
 const readOrder=async()=>{lookups++;return Response.json(options.orders||{shop,orders:[{id:'gid://shopify/Order/2',name:'#1002'}]});};
 return {env,request,readOrder,writes,requests,get lookups(){return lookups;}};
}
test('link endpoint is disabled without isolated backend',async()=>{
 const s=setup();delete s.env.WORKSPACE_BACKEND;
 assert.equal((await workspaceRoute(s.request(),s.env,shop,true,s.readOrder)).status,503);
 assert.equal(s.requests.length,0);
});
test('store owner and workspace session are both required',async()=>{
 const s=setup();
 assert.equal((await workspaceRoute(s.request(),s.env,shop,false,s.readOrder)).status,403);
 assert.equal((await workspaceRoute(s.request(undefined,undefined,'invalid'),s.env,shop,true,s.readOrder)).status,401);
 assert.equal(s.requests.length,0);
});
for(const user of [{role:'client'},{status:'blocked'},{workspace_id:''}])test('reject unapproved workspace identity '+JSON.stringify(user),async()=>{
 const s=setup({user});assert.equal((await workspaceRoute(s.request(),s.env,shop,true,s.readOrder)).status,403);assert.equal(s.writes.length,0);
});
test('session is sent only to fixed service binding',async()=>{
 const s=setup();const response=await workspaceRoute(s.request(),s.env,shop,true,s.readOrder);
 assert.equal(response.status,200);assert.ok(s.requests.every(r=>r.url.startsWith('https://workspace.internal/')));
 assert.ok(s.requests.every(r=>r.authorization==='Bearer '+session));
 assert.ok(!JSON.stringify(s.writes).includes(session));assert.ok(!(await response.text()).includes(session));
});
test('caller cannot override workspace or shop',async()=>{
 const s=setup();assert.equal((await workspaceRoute(s.request({ticketId:42,order:'1002',workspace_id:'other'}),s.env,shop,true,s.readOrder)).status,400);assert.equal(s.writes.length,0);
});
for(const ticketWorkspace of [null,'other'])test('reject missing or cross-workspace ticket '+ticketWorkspace,async()=>{
 const s=setup({ticketWorkspace});assert.equal((await workspaceRoute(s.request(),s.env,shop,true,s.readOrder)).status,403);assert.equal(s.lookups,0);assert.equal(s.writes.length,0);
});
test('another workspace cannot relink a shop',async()=>{
 const s=setup({linked:'other'});assert.equal((await workspaceRoute(s.request({},'/api/workspace-link'),s.env,shop,true,s.readOrder)).status,409);
 assert.ok(s.writes[0].sql.includes('DO NOTHING'));
});
test('workspace identity comes from verified backend',async()=>{
 const s=setup({linked:null});const r=await workspaceRoute(s.request({},'/api/workspace-link'),s.env,shop,true,s.readOrder);
 assert.equal(r.status,200);assert.deepEqual(s.writes[0].values,[shop,'alpha',7]);
});
for(const orders of [{shop:'other.myshopify.com',orders:[{id:'gid://shopify/Order/2',name:'#1002'}]}, {shop,orders:[{id:'gid://shopify/Order/2',name:'#10020'}]}])test('reject wrong shop or inexact order '+JSON.stringify(orders),async()=>{
 const s=setup({orders});assert.equal((await workspaceRoute(s.request(),s.env,shop,true,s.readOrder)).status,404);assert.equal(s.writes.length,0);
});
test('valid link stores identifiers only',async()=>{
 const s=setup();assert.equal((await workspaceRoute(s.request(),s.env,shop,true,s.readOrder)).status,200);
 assert.deepEqual(s.writes[0].values,[shop,'alpha',42,'gid://shopify/Order/2',7]);
});
test('expired workspace session cannot link',async()=>{
 const s=setup({authStatus:401});assert.equal((await workspaceRoute(s.request(),s.env,shop,true,s.readOrder)).status,401);assert.equal(s.writes.length,0);
});
test('HTTP route verifies Shopify owner against signed user',async()=>{
 const s=setup({linked:null});Object.assign(s.env,{SHOPIFY_API_KEY:'key',SHOPIFY_API_SECRET:'secret',SHOPIFY_API_VERSION:'2026-10'});
 const now=Math.floor(Date.now()/1000),b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const unsigned=b({alg:'HS256'})+'.'+b({aud:'key',sub:'9',exp:now+60,nbf:now-1,dest:'https://'+shop,iss:'https://'+shop+'/admin'});
 const token=unsigned+'.'+createHmac('sha256','secret').update(unsigned).digest('base64url');
 const req=()=>new Request('https://staging.example/api/workspace-link',{method:'POST',headers:{authorization:'Bearer '+token,'x-workspace-session':session},body:'{}'});
 const exchange=id=>async()=>Response.json({access_token:'shopify-secret',associated_user_scope:'read_orders',associated_user:{id,account_owner:true}});
 assert.equal((await handle(req(),s.env,exchange(8))).status,403);assert.equal(s.requests.length,0);
 assert.equal((await handle(req(),s.env,exchange(9))).status,200);
});
