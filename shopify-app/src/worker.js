import { page } from './page.js';
const enc = new TextEncoder();
const shopPattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const topics = new Set(['app/uninstalled','customers/data_request','customers/redact','shop/redact']);
const decode = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function key(secret){ return crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']); }
export async function authenticate(token, env, now=Date.now()/1000){
 try {
  const parts = token.split('.'); if(parts.length!==3) throw Error();
  const [h,p,s]=parts; const header=JSON.parse(new TextDecoder().decode(decode(h)));
  if(header.alg!=='HS256') throw Error();
  if(!await crypto.subtle.verify('HMAC',await key(env.SHOPIFY_API_SECRET),decode(s),enc.encode(`${h}.${p}`))) throw Error();
  const c=JSON.parse(new TextDecoder().decode(decode(p)));
  if(!Number.isFinite(c.exp)||!Number.isFinite(c.nbf)||c.exp<=now||c.nbf>now||c.aud!==env.SHOPIFY_API_KEY||!c.sub) throw Error();
  const dest=new URL(c.dest), issuer=new URL(c.iss);
  if(dest.protocol!=='https:'||issuer.protocol!=='https:'||!shopPattern.test(dest.hostname)||dest.origin!==issuer.origin||dest.href!==`${dest.origin}/`||issuer.pathname!=='/admin'||dest.port||dest.username||dest.password||issuer.search||issuer.hash) throw Error();
  return dest.hostname;
 } catch { throw new Response('Invalid Shopify session',{status:401,headers:{'X-Shopify-Retry-Invalid-Session-Request':'1','cache-control':'no-store'}}); }
}
export async function verifyWebhook(raw,signature,secret){
 try{return await crypto.subtle.verify('HMAC',await key(secret),decode(signature),raw);}catch{return false;}
}
async function webhook(request,env){
 const raw=await request.arrayBuffer();
 if(!await verifyWebhook(raw,request.headers.get('x-shopify-hmac-sha256')||'',env.SHOPIFY_API_SECRET)) return json({error:'Invalid signature'},401);
 const shop=request.headers.get('x-shopify-shop-domain'), topic=request.headers.get('x-shopify-topic'), id=request.headers.get('x-shopify-webhook-id');
 if(!shopPattern.test(shop||'')||!topics.has(topic)||!id||id.length>200) return json({error:'Invalid webhook headers'},400);
 // Payloads are deliberately discarded, including customer identifiers.
 // Batch mutation and receipt together: failures return 503 so Shopify retries.
 const statements=[];
 if(topic==='app/uninstalled'||topic==='shop/redact') statements.push(env.DB.prepare('DELETE FROM shops WHERE shop = ?').bind(shop));
 if(topic==='shop/redact') statements.push(env.DB.prepare('DELETE FROM webhook_receipts WHERE shop = ?').bind(shop));
 else statements.push(env.DB.prepare('INSERT OR IGNORE INTO webhook_receipts(shop,id,topic) VALUES(?,?,?)').bind(shop,id,topic));
 await env.DB.batch(statements);
 return json({accepted:true});
}
async function orders(request,env,fetcher){
 const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
 const shop=await authenticate(token,env);
 const q=new URL(request.url).searchParams.get('order')||'';
 if(q&&!/^#?[0-9]{1,20}$/.test(q)) return json({error:'Enter a numeric order number'},400);
 const exchange=await fetcher(`https://${shop}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.SHOPIFY_API_KEY,client_secret:env.SHOPIFY_API_SECRET,grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:token,subject_token_type:'urn:ietf:params:oauth:token-type:id_token',requested_token_type:'urn:shopify:params:oauth:token-type:online-access-token'}),signal:AbortSignal.timeout(10000)});
 if(exchange.status===400||exchange.status===401) throw new Response('Reopen NovaraDesk from Shopify',{status:401,headers:{'X-Shopify-Retry-Invalid-Session-Request':'1'}});
 if(!exchange.ok) return json({error:'Shopify authentication temporarily unavailable'},502);
 const access=await exchange.json();
 if(!access.access_token) return json({error:'Shopify authentication failed'},502);
 if(!(access.associated_user_scope||'').split(',').includes('read_orders')) return json({error:'Your Shopify staff account needs order access'},403);
 const result=await fetcher(`https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,{method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':access.access_token},body:JSON.stringify({query:'query Orders($query:String!){ orders(first:20,sortKey:CREATED_AT,reverse:true,query:$query){nodes{id name createdAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet{shopMoney{amount currencyCode}}}}}',variables:{query:q?`name:${q.replace(/^#/,'')}`:''}}),signal:AbortSignal.timeout(10000)});
 if(result.status===429) return json({error:'Shopify is busy. Please retry shortly.'},429);
 if(!result.ok) return json({error:'Unable to read orders. Check Shopify permissions.'},502);
 const data=await result.json();
 if(data.errors) return json({error:'Shopify could not return orders. Check app access approval.'},502);
 await env.DB.prepare('INSERT OR IGNORE INTO shops(shop,installed_at) VALUES(?,?)').bind(shop,new Date().toISOString()).run();
 return json({shop,orders:data.data.orders.nodes});
}
export async function handle(request,env,fetcher=fetch){
 try{
 const url=new URL(request.url);
 if(url.pathname==='/health') return json({service:'novaradesk-shopify',status:'ok'});
 if(!env.SHOPIFY_API_KEY||!env.SHOPIFY_API_SECRET||!env.DB||!/^\d{4}-(01|04|07|10)$/.test(env.SHOPIFY_API_VERSION||'')) return json({error:'Shopify staging configuration required'},503);
 if(url.pathname==='/webhooks'&&request.method==='POST') return await webhook(request,env);
 if(url.pathname==='/api/orders'&&request.method==='GET') return await orders(request,env,fetcher);
 if(url.pathname==='/'&&request.method==='GET'){
 const shop=url.searchParams.get('shop');
 const csp=`default-src 'self'; script-src 'self' https://cdn.shopify.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.shopify.com https://*.myshopify.com; frame-ancestors https://admin.shopify.com${shopPattern.test(shop||'')?' https://'+shop:''}; base-uri 'none'; object-src 'none'`;
 return new Response(page(env.SHOPIFY_API_KEY),{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','content-security-policy':csp,'referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
 }
 if(url.pathname==='/app.js'&&request.method==='GET') return new Response(client,{headers:{'content-type':'text/javascript','cache-control':'no-store'}});
 return json({error:'Not found'},404);
 }catch(e){if(e instanceof Response)return e; return json({error:'Service temporarily unavailable. Please retry.'},503);}
}
const client = `const form=document.querySelector('form'), status=document.querySelector('[role=status]'), body=document.querySelector('tbody');
async function load(event){event?.preventDefault();const button=document.querySelector('button');button.disabled=true;status.textContent='Loading orders…';body.replaceChildren();
try {if(!window.shopify)throw Error('Open NovaraDesk from your Shopify admin.');const token=await shopify.idToken();const response=await fetch('/api/orders?order='+encodeURIComponent(form.elements.order.value),{headers:{Authorization:'Bearer '+token}});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load orders');for(const o of data.orders){const row=document.createElement('tr');for(const value of [o.name,new Date(o.createdAt).toLocaleDateString(),o.displayFinancialStatus,o.displayFulfillmentStatus,o.currentTotalPriceSet.shopMoney.amount+' '+o.currentTotalPriceSet.shopMoney.currencyCode]){const td=document.createElement('td');td.textContent=value;row.append(td)}body.append(row)}status.textContent=data.orders.length+' orders · '+data.shop;}catch(e){status.textContent=e.message}finally{button.disabled=false}}
form.addEventListener('submit',load);load();`;
// Cloudflare supplies ExecutionContext as the third argument; keep it out of the injected HTTP client.
export default {fetch(request, env) { return handle(request, env); }};
