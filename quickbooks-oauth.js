'use strict';
// PAL QuickBooks Online OAuth — BAA only, no accounting writes.
const crypto = require('crypto');
const TENANT = 'born-again-air';
const BASE = 'https://palbiz.app';
const CALLBACK = `${BASE}/quickbooks/callback`;
const INTUIT_AUTH = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const enc = v => encodeURIComponent(v);
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports = function registerQuickBooks(app, { getAuth, membership, isOwner }) {
 const supa = (process.env.SUPABASE_URL||'').replace(/\/$/,'');
 const supaKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
 const clientId = process.env.QBO_CLIENT_ID || '';
 const secret = process.env.QBO_CLIENT_SECRET || '';
 const rawKey = process.env.QBO_TOKEN_ENCRYPTION_KEY || '';
 const key = /^[0-9a-f]{64}$/i.test(rawKey) ? Buffer.from(rawKey,'hex') : null;
 const ready = () => Boolean(supa && supaKey && clientId && secret && key);
 const trustedOrigins = new Set(['https://palbiz.app','https://www.palbiz.app']);
 function requireSameOrigin(req,res,next) {
  const origin=req.get('origin');
  if (!origin || !trustedOrigins.has(origin)) return res.status(403).send('Invalid request origin');
  const fetchSite=req.get('sec-fetch-site');
  if (fetchSite && !['same-origin','same-site'].includes(fetchSite)) return res.status(403).send('Cross-site request rejected');
  next();
 }
 const headers = {apikey:supaKey, Authorization:`Bearer ${supaKey}`,'Content-Type':'application/json'};
 const auth = 'Basic '+Buffer.from(`${clientId}:${secret}`).toString('base64');
 function authorized(req,res,next) {
  const user = getAuth(req).userId;
  if(!user) return res.redirect('/login');
  const m = membership(req);
  if(!(isOwner(req) || (m.role==='manager' && m.companies.includes(TENANT)))) return res.status(403).send('Company manager access required');
  next();
 }
 function page(title,body) {return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | PAL</title><link rel="stylesheet" href="/assets/style.css"></head><body><main style="max-width:680px;margin:10vh auto;padding:28px;font:16px/1.6 system-ui"><h1>${esc(title)}</h1>${body}<p><a href="/company/born-again-air">Return to BAA workspace</a></p></main><footer class="pal-legal-footer">© 2026 PAL Business Solutions, LLC · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer></body></html>`;}
 async function db(table,{method='GET',query='',body,prefer}={}) {
  if(!supa||!supaKey) throw new Error('Database not configured');
  const r = await fetch(`${supa}/rest/v1/${table}${query?'?'+query:''}`,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!r.ok) throw new Error(`QuickBooks database ${table} request failed (${r.status})`);
  const t=await r.text(); return t?JSON.parse(t):[];
 }
 function encrypt(obj){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(obj),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
 function decrypt(s){const b=Buffer.from(s,'base64');const dec=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));dec.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([dec.update(b.subarray(28)),dec.final()]).toString('utf8'));}
 async function tokenRequest(params){const r=await fetch(TOKEN_URL,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(params)});if(!r.ok)throw new Error(`Intuit token exchange failed (${r.status})`);return r.json();}
 async function connection(){const rows=await db('pal_qbo_connections',{query:`tenant=eq.${TENANT}&select=tenant,encrypted_realm_id,encrypted_tokens,updated_at&limit=1`});const row=rows[0];return row?{...row,realm_id:decrypt(row.encrypted_realm_id).realm_id}:null;}
 function error(res,e){console.error('PAL QBO:',e.message);return res.status(503).send(page('QuickBooks unavailable','<p>QuickBooks connection is not ready. No accounting changes were made. Contact PAL support.</p>'));}
 app.get('/quickbooks/connect',authorized,async(req,res)=>{
  try {const c=ready()?await connection():null;res.send(page('Connect QuickBooks',`<p>Connect Born Again Air’s QuickBooks Online company to PAL. Only an authorized company manager may approve access.</p>${c?`<p><strong>Connected QuickBooks company:</strong> ${esc(c.realm_id)}</p><p>Reconnect only to the same company.</p>`:''}${ready()?'<form method="post" action="/quickbooks/connect/start"><button type="submit">Connect or reconnect QuickBooks</button></form>':'<p><strong>Connection is not enabled yet.</strong> PAL must configure Intuit credentials and encrypted storage first.</p>'}<p>PAL will use read-only accounting API requests during initial testing. No bills, payments, or expenses will be created.</p>`));}
  catch(e){error(res,e)}
 });
 app.post('/quickbooks/connect/start',authorized,requireSameOrigin,async(req,res)=>{
  if(!ready())return res.status(503).send(page('Not configured','<p>Production credentials and encryption are required.</p>'));
  try{
   const state=crypto.randomBytes(32).toString('hex');
   await db('pal_qbo_oauth_states',{method:'POST',body:{state_hash:crypto.createHash('sha256').update(state).digest('hex'),tenant:TENANT,clerk_user_id:getAuth(req).userId,expires_at:new Date(Date.now()+10*60*1000).toISOString()}});
   const u=new URL(INTUIT_AUTH);u.search=new URLSearchParams({client_id:clientId,response_type:'code',scope:'com.intuit.quickbooks.accounting',redirect_uri:CALLBACK,state}).toString();
   res.redirect(303,u.toString());
  }catch(e){error(res,e)}
 });
 // OAuth callback is public: state is a one-time, server-stored, cryptographically random secret.
 app.get('/quickbooks/callback',async(req,res)=>{
  // Never return HTML at a token-bearing callback URL. All outcomes redirect to a clean URL.
  res.set('Cache-Control','no-store, no-cache');
  res.set('Referrer-Policy','no-referrer');
  const done=(status)=>res.redirect(302,`/quickbooks/result?status=${status}`);
  if(!ready())return done('unavailable');
  const {state,code,realmId,error:oauthError}=req.query;
  if(typeof state!=='string'||!(/^[0-9a-f]{64}$/.test(state)))return done('invalid');
  try {
   const hash=crypto.createHash('sha256').update(state).digest('hex');
   const rows=await db('pal_qbo_oauth_states',{method:'DELETE',query:`state_hash=eq.${hash}&tenant=eq.${TENANT}&expires_at=gt.${enc(new Date().toISOString())}&select=state_hash,clerk_user_id`,prefer:'return=representation'});
   if(rows.length!==1)return done('expired');
   // Bind the OAuth response to the same signed-in, still-authorized manager who initiated it.
   const callbackUser=getAuth(req).userId;
   const initiatedBy=rows[0].clerk_user_id;
   const m=membership(req);
   if(!callbackUser || callbackUser!==initiatedBy || !(isOwner(req) || (m.role==='manager' && m.companies.includes(TENANT))))
    return done('unauthorized'); 
   if(oauthError)return done('cancelled');
   if(typeof code!=='string'||typeof realmId!=='string'||!/^\d{5,30}$/.test(realmId))return done('invalid');
   const current=await connection();
   if(current && current.realm_id!==realmId)return done('wrong-company');
   const tokens=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:CALLBACK});
   if(!tokens.access_token||!tokens.refresh_token)throw new Error('Incomplete token response');
   await db('pal_qbo_connections',{method:'POST',query:'on_conflict=tenant',prefer:'resolution=merge-duplicates',body:{tenant:TENANT,encrypted_realm_id:encrypt({realm_id:realmId}),encrypted_tokens:encrypt({access_token:tokens.access_token,refresh_token:tokens.refresh_token,access_expires_at:Date.now()+tokens.expires_in*1000,refresh_expires_at:Date.now()+(tokens.x_refresh_token_expires_in||0)*1000}),updated_at:new Date().toISOString()}});
   done('connected');
  }catch(e){console.error('PAL QBO callback:',e.message);done('unavailable')}
 });
 app.get('/quickbooks/result',authorized,(req,res)=>{
  const messages={connected:'Born Again Air QuickBooks is connected. No accounting transactions were modified.',cancelled:'QuickBooks authorization was cancelled.',expired:'Authorization expired or was already used. Start again from PAL.',invalid:'Invalid authorization response. Start again from PAL.',unauthorized:'Sign in as the same authorized BAA manager and start again.', 'wrong-company':'This PAL workspace is already linked to a different QuickBooks company. Contact PAL support.',unavailable:'QuickBooks connection is temporarily unavailable.'};
  const status=typeof req.query.status==='string'?req.query.status:'invalid';
  res.set('Cache-Control','no-store, no-cache');res.send(page('QuickBooks connection',`<p>${messages[status]||messages.invalid}</p>`));
 });
 app.get('/quickbooks/disconnect',authorized,async(req,res)=>{
  try{const c=ready()?await connection():null;res.send(page('Disconnect QuickBooks',`<p>${c?`Born Again Air is connected to QuickBooks company ${esc(c.realm_id)}.`:'No active QuickBooks connection is available.'}</p>${c?'<p>Disconnecting removes PAL’s stored authorization. It does not delete any QuickBooks transactions.</p><form method="post" action="/quickbooks/disconnect"><button type="submit">Confirm disconnect</button></form>':''}`));}catch(e){error(res,e)}
 });
 app.post('/quickbooks/disconnect',authorized,requireSameOrigin,async(req,res)=>{
  if(!ready())return res.status(503).send('Not configured');
  try{const c=await connection();if(!c)return res.send(page('Already disconnected','<p>No QuickBooks connection exists.</p>'));
   const tokens=decrypt(c.encrypted_tokens);
   const r=await fetch(REVOKE_URL,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({token:tokens.refresh_token})});
   if(!r.ok)throw new Error(`Intuit token revocation failed (${r.status})`);
   await db('pal_qbo_connections',{method:'DELETE',query:`tenant=eq.${TENANT}`});
   res.send(page('QuickBooks disconnected','<p>PAL’s QuickBooks authorization was revoked and the stored connection removed.</p>'));
  }catch(e){error(res,e)}
 });
 app.get('/api/baa/quickbooks/test',authorized,async(req,res)=>{
  if(!ready())return res.status(503).json({error:'QuickBooks not configured'});
  try{const c=await connection();if(!c)return res.status(404).json({error:'BAA QuickBooks not connected'});
   let tokens=decrypt(c.encrypted_tokens);
   if(Date.now()>tokens.access_expires_at-120000){
    const next=await tokenRequest({grant_type:'refresh_token',refresh_token:tokens.refresh_token});
    tokens={access_token:next.access_token,refresh_token:next.refresh_token,access_expires_at:Date.now()+next.expires_in*1000,refresh_expires_at:Date.now()+(next.x_refresh_token_expires_in||0)*1000};
    await db('pal_qbo_connections',{method:'PATCH',query:`tenant=eq.${TENANT}`,body:{encrypted_tokens:encrypt(tokens),updated_at:new Date().toISOString()}});
   }
   // SELECT is read-only; no POST/PUT/DELETE to accounting endpoints in this module.
   const q="select * from Vendor maxresults 5";
   const u=`${API_BASE}/${enc(c.realm_id)}/query?query=${enc(q)}&minorversion=75`;
   const r=await fetch(u,{headers:{Authorization:`Bearer ${tokens.access_token}`,Accept:'application/json'}});
   if(!r.ok)throw new Error(`QBO read-only test failed (${r.status})`);
   const data=await r.json();
   res.set('Cache-Control','no-store');res.json({ok:true,tenant:TENANT,vendorCount:(data.QueryResponse?.Vendor||[]).length,readOnly:true});
  }catch(e){console.error('QBO read test:',e.message);res.status(503).json({error:'QuickBooks read-only test failed'});}
 });
};
