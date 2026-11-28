// Isolated Shopify test backend. Never bind the production Novara D1 database.
const encoder = new TextEncoder();
const shopPattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const portalOrigin = 'https://novaradesk-shopify-staging.rishi-rana96.workers.dev';
const json = (body,status=200,extra={}) => Response.json(body,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff',...extra
}});
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export async function hash(value) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
}
const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const jwtJson = value => JSON.parse(new TextDecoder().decode(decode(value)));
export async function verifyGoogle(token,clientId,nonce,fetcher=fetch,now=Date.now()/1000) {
 const parts=String(token||'').split('.');if(parts.length!==3)throw Error('credential');
 const header=jwtJson(parts[0]),claims=jwtJson(parts[1]);
 if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('algorithm');
 if(claims.aud!==clientId||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||
   !Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||
   (claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+60))||
   claims.email_verified!==true||typeof claims.sub!=='string'||!claims.sub||
   typeof claims.email!=='string'||claims.nonce!==nonce)throw Error('claims');
 const res=await fetcher('https://www.googleapis.com/oauth2/v3/certs',{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('keys');
 const jwk=(await res.json()).keys?.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)throw Error('key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),encoder.encode(parts[0]+'.'+parts[1])))throw Error('signature');
 return {email:claims.email.toLowerCase().trim(),sub:claims.sub};
}
function cookie(request,name) {
 return (request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
}
async function sessionUser(request,env,now) {
 const authorization=request.headers.get('authorization')||'';
 const token=authorization.startsWith('Bearer ')?authorization.slice(7):cookie(request,'__Host-novara-staging');
 if(!/^novara_[a-f0-9]{64}$/.test(token))return null;
 return env.DB.prepare(`SELECT u.id,u.role,u.status,u.workspace_id FROM app_sessions s
 JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' LIMIT 1`)
 .bind(await hash(token),now).first();
}
async function createSession(env,userId,now) {
 const token='novara_'+random(),expiresAt=now+3600;
 await env.DB.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(token),userId,expiresAt).run();
 return {token,expiresAt};
}
export async function handleWorkspace(request,env,fetcher=fetch) {
 try {
 const url=new URL(request.url),path=url.pathname,now=Math.floor(Date.now()/1000);
 if(path==='/health'&&request.method==='GET')return json({service:'novaradesk-workspace-staging',status:env.DB?'ok':'configuration-required',staging:true});
 if(!env.DB)return json({error:'Staging database required'},503);
 if(path==='/'&&request.method==='GET')return new Response(loginPage(env.GOOGLE_CLIENT_ID||''),{headers:{
  'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'cross-origin-opener-policy':'same-origin-allow-popups','x-content-type-options':'nosniff'
 }});
 if(path==='/login.js'&&request.method==='GET')return new Response(loginScript,{headers:{'content-type':'text/javascript','cache-control':'no-store'}});
 const mutation=request.method==='POST';
 if(mutation&&path!=='/auth/handoff/exchange'&&request.headers.get('origin')!==url.origin)
  return json({error:'Same-origin request required'},403);
 if(path==='/auth/challenge'&&request.method==='POST') {
  if(!env.GOOGLE_CLIENT_ID)return json({error:'Staging Google sign-in configuration required'},503);
  const nonce=random();
  await env.DB.batch([
   env.DB.prepare('DELETE FROM login_challenges WHERE expires_at<=?').bind(now),
   env.DB.prepare('DELETE FROM app_sessions WHERE expires_at<=?').bind(now),
   env.DB.prepare('DELETE FROM handoff_codes WHERE expires_at<=?').bind(now),
   env.DB.prepare('INSERT INTO login_challenges(nonce_hash,expires_at) VALUES(?,?)').bind(await hash(nonce),now+300)
  ]);
  return json({nonce,clientId:env.GOOGLE_CLIENT_ID},200,{'set-cookie':'__Host-staging-nonce='+nonce+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300'});
 }
 if(path==='/auth/google'&&mutation) {
  const nonce=cookie(request,'__Host-staging-nonce');
  if(!/^[a-f0-9]{64}$/.test(nonce)||!env.GOOGLE_CLIENT_ID)return json({error:'Start a fresh sign-in'},401);
  let profile;
  try {const body=await request.json();profile=await verifyGoogle(body.credential,env.GOOGLE_CLIENT_ID,nonce,fetcher);}catch{return json({error:'Google sign-in could not be verified'},401);}
  const challenge=await env.DB.prepare('DELETE FROM login_challenges WHERE nonce_hash=? AND expires_at>? RETURNING nonce_hash').bind(await hash(nonce),now).first();
  if(!challenge)return json({error:'Sign-in request expired or already used'},401);
  const user=await env.DB.prepare("SELECT id,google_sub FROM app_users WHERE email=? AND status='active' LIMIT 1").bind(profile.email).first();
  if(!user||(user.google_sub&&user.google_sub!==profile.sub))return json({error:'Staging workspace access has not been provisioned'},403);
  await env.DB.prepare('UPDATE app_users SET google_sub=? WHERE id=? AND (google_sub IS NULL OR google_sub=?)').bind(profile.sub,user.id,profile.sub).run();
  const {token}=await createSession(env,user.id,now);
  return json({success:true},200,{'set-cookie':'__Host-novara-staging='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600'});
 }
 if(path==='/auth/handoff/exchange'&&mutation) {
  // A random, one-use 60-second code is the credential for this endpoint.
  // It is passed in a POST body through the staging service binding, never a URL.
  let body;try{body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
  if(!/^[a-f0-9]{64}$/.test(body?.code||'')||!shopPattern.test(body?.shop||''))return json({error:'Invalid connection code'},400);
  const code=await env.DB.prepare(`DELETE FROM handoff_codes WHERE code_hash=? AND shop=? AND expires_at>?
   RETURNING user_id`).bind(await hash(body.code),body.shop,now).first();
  if(!code)return json({error:'Connection code expired or already used'},401);
  const user=await env.DB.prepare("SELECT id FROM app_users WHERE id=? AND status='active' AND role='admin'").bind(code.user_id).first();
  if(!user)return json({error:'Workspace access denied'},403);
  return json(await createSession(env,user.id,now));
 }
 const user=await sessionUser(request,env,now);
 if(!user)return json({error:'Staging sign-in required'},401);
 if(path==='/auth/me'&&request.method==='GET')return json({user});
 if(path==='/auth/logout'&&mutation) {
  const token=cookie(request,'__Host-novara-staging');
  if(token)await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash=?').bind(await hash(token)).run();
  return json({success:true},200,{'set-cookie':'__Host-novara-staging=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'});
 }
 if(path==='/auth/handoff'&&mutation) {
  if(user.role!=='admin')return json({error:'Administrator required'},403);
  let body;try{body=await request.json();}catch{return json({error:'Invalid JSON'},400);}
  if(!shopPattern.test(body?.shop||''))return json({error:'Invalid Shopify store'},400);
  const code=random();
  await env.DB.prepare('INSERT INTO handoff_codes(code_hash,user_id,shop,expires_at) VALUES(?,?,?,?)').bind(await hash(code),user.id,body.shop,now+60).run();
  return json({code});
 }
 if(path==='/ticket-detail'&&request.method==='GET') {
  const value=url.searchParams.get('id')||'',id=Number(value);
  if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(id))return json({error:'Valid ticket ID required'},400);
  const ticket=await env.DB.prepare('SELECT id,workspace_id,subject,status FROM tickets WHERE id=? AND workspace_id=? LIMIT 1').bind(id,user.workspace_id).first();
  return ticket?json({ticket}):json({error:'Ticket not found'},404);
 }
 if(path==='/tickets'&&request.method==='GET') {
  const rows=await env.DB.prepare('SELECT id,workspace_id,subject,status FROM tickets WHERE workspace_id=? ORDER BY id LIMIT 50').bind(user.workspace_id).all();
  return json({tickets:rows.results||[]});
 }
 return json({error:'Not found'},404);
 }catch{return json({error:'Staging service temporarily unavailable'},503);}
}
function loginPage(clientId) {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NovaraDesk · Staging connection</title><style>body{font:16px system-ui;background:#f6f7f8;color:#202223;margin:0}main{max-width:600px;margin:64px auto;padding:32px;background:white;border:1px solid #ddd;border-radius:14px}h1{font-size:24px}p{line-height:1.6;color:#61656a}button{font:inherit;padding:12px 16px;border-radius:8px;border:1px solid #aaa;cursor:pointer}#connect{margin-top:20px}</style><script src="https://accounts.google.com/gsi/client" defer></script><script src="/login.js" defer></script></head><body><main><small>NOVARADESK · STAGING</small><h1>Connect your test workspace</h1><p>Sign in to connect the Shopify development store to your test tickets.</p><div id="google"></div><p role="status" aria-live="polite">${clientId?'Checking sign-in…':'Google sign-in is awaiting configuration.'}</p><button id="connect" hidden>Connect workspace</button><p>Test workspace only. This connection does not change your live NovaraDesk.</p></main></body></html>`;
}
const loginScript=`const status=document.querySelector('[role=status]'),button=document.querySelector('#connect');
const shop=new URL(location.href).searchParams.get('shop');
async function ready(){status.textContent='Signed in to your staging workspace.';button.hidden=!shop||!window.opener;}
async function start(){const me=await fetch('/auth/me');if(me.ok){await ready();return;}const response=await fetch('/auth/challenge',{method:'POST'});const config=await response.json();if(!response.ok)throw Error(config.error);google.accounts.id.initialize({client_id:config.clientId,nonce:config.nonce,callback:async(result)=>{try{const response=await fetch('/auth/google',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential:result.credential})});const data=await response.json();if(!response.ok)throw Error(data.error);await ready();}catch(error){status.textContent=error.message;}}});google.accounts.id.renderButton(document.querySelector('#google'),{theme:'outline',size:'large'});status.textContent='Sign in with your approved staging account.';}
button.addEventListener('click',async()=>{button.disabled=true;try{const response=await fetch('/auth/handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({shop})});const data=await response.json();if(!response.ok)throw Error(data.error);window.opener.postMessage({type:'novara-staging-connection',code:data.code},'${portalOrigin}');status.textContent='Connection sent. Return to Shopify.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
window.addEventListener('load',()=>start().catch(error=>status.textContent=error.message));`;
export default {fetch(request,env){return handleWorkspace(request,env);}};
