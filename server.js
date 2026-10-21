require('dotenv').config();
const express = require('express');
const path = require('path');
const { clerkMiddleware, getAuth } = require('@clerk/express');
const app = express();
const PORT = process.env.PORT || 10000;
app.disable('x-powered-by');
app.set('trust proxy', 1);
const origins = (process.env.CLERK_AUTHORIZED_PARTIES || 'https://palbiz.app,https://www.palbiz.app').split(',').map(x=>x.trim()).filter(Boolean);
app.use(clerkMiddleware({authorizedParties: origins}));
app.use('/assets',express.static(path.join(__dirname,'public'),{index:false,maxAge:'1h'}));
const ownerId = process.env.PAL_OWNER_CLERK_USER_ID || '';
const companies = [{id:'born-again-air',name:'Born Again Air',short:'BAA'},{id:'newstart',name:'Newstart',short:'NS'}];
const isOwner = req => Boolean(ownerId && getAuth(req).userId === ownerId);
const isSignedIn = req => Boolean(getAuth(req).userId);
function membership(req){
  if(isOwner(req)) return {role:'pal_owner',companies:companies.map(x=>x.id)};
  const userId=getAuth(req).userId;
  if(!userId) return {role:'guest',companies:[]};
  // Optional server-managed bootstrap membership map. NEVER accept roles from browser requests.
  let map={}; try {map=JSON.parse(process.env.PAL_COMPANY_MEMBERSHIPS_JSON || '{}');}catch(e){console.error('Invalid PAL_COMPANY_MEMBERSHIPS_JSON');}
  const record=map[userId];
  if(!record || !['manager','employee'].includes(record.role) || !companies.some(c=>c.id===record.company)) return {role:'unassigned',companies:[]};
  return {role:record.role,companies:[record.company]};
}
function html(req,view,title){
  const state={view,publishableKey:process.env.CLERK_PUBLISHABLE_KEY||'',signedIn:isSignedIn(req),owner:isOwner(req),membership:membership(req),companies,dropbox:{'born-again-air':process.env.PAL_BAA_DROPBOX_URL||'',newstart:process.env.PAL_NEWSTART_DROPBOX_URL||''}};
  const safe=JSON.stringify(state).replace(/</g,'\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a1427"><title>${title} | PAL Business Solutions</title><link rel="stylesheet" href="/assets/style.css"></head><body><div id="app"></div><script id="pal-state" type="application/json">${safe}</script><script src="/assets/app.js" defer></script></body></html>`;
}
function requireOwner(req,res,next){if(!isSignedIn(req))return res.status(401).json({error:'Sign in required'});if(!isOwner(req))return res.status(403).json({error:'Owner access required'});next();}
function requireCompany(req,res,next){const c=req.params.company;if(!companies.some(x=>x.id===c))return res.status(404).json({error:'Company not found'});if(!membership(req).companies.includes(c))return res.status(403).json({error:'No access to this company'});next();}
app.get('/health',(_req,res)=>res.json({status:'ok'}));
app.get('/',(req,res)=>res.send(html(req,'home','Home')));
app.get(['/login','/sign-in'],(req,res)=>res.send(html(req,'login','Sign In')));
app.get(['/register','/sign-up'],(req,res)=>res.send(html(req,'register','Create Account')));
app.get('/owner',(req,res)=>{if(!isSignedIn(req))return res.redirect('/login?next=owner');if(!isOwner(req))return res.status(403).send(html(req,'forbidden','Access Denied'));res.set('Cache-Control','no-store');res.send(html(req,'owner','Owner Dashboard'));});
app.get('/company/:company',(req,res)=>{
  const company=req.params.company;
  if(!companies.some(c=>c.id===company))return res.status(404).send('Company not found');
  if(!isSignedIn(req))return res.redirect('/login?next=company');
  if(!membership(req).companies.includes(company))return res.status(403).send(html(req,'forbidden','Access Denied'));
  res.set('Cache-Control','no-store');
  return res.send(html(req,company==='born-again-air'?'baa':'newstart','Company Workspace'));
});
app.get(['/app','/portal'],(req,res)=>{if(!isSignedIn(req))return res.redirect('/login?next=app');if(isOwner(req))return res.redirect('/owner');res.set('Cache-Control','no-store');res.send(html(req,'customer','Workspace'));});
// Temporary owner-access diagnostic. Remove after troubleshooting.
app.get('/api/owner-diagnostic', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const userId = getAuth(req).userId || '';
  const configuredId = process.env.PAL_OWNER_CLERK_USER_ID || '';
  res.json({
    signedIn: Boolean(userId),
    ownerVariablePresent: Boolean(configuredId),
    ownerVariableHasOuterWhitespace: configuredId !== configuredId.trim(),
    ownerIdMatchesSession: Boolean(userId && configuredId && userId === configuredId),
    recognizedRole: membership(req).role
  });
});
app.get('/api/me',(req,res)=>{if(!isSignedIn(req))return res.status(401).json({error:'Sign in required'});res.set('Cache-Control','no-store');res.json({userId:getAuth(req).userId,...membership(req)});});
// Optional private Supabase Storage documents. Service key stays SERVER SIDE.
const supaUrl=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const supaKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const bucket=process.env.PAL_SUPABASE_BUCKET||'pal-private-documents';
const storageReady=Boolean(supaUrl&&supaKey);
function storageHeaders(extra={}){return {apikey:supaKey,Authorization:`Bearer ${supaKey}`,...extra};}
function storagePath(company,name){return `${company}/${name}`;}
function storageError(res,status=502){return res.status(status).json({error:'Storage operation failed. Check the private Supabase bucket and configuration.'});}
app.get('/api/owner/storage-status',requireOwner,(_req,res)=>res.json({configured:storageReady,bucket}));
app.get('/api/owner/files/:company',requireOwner,requireCompany,async(req,res)=>{
  if(!storageReady)return res.json({configured:false,files:[]});
  try {const r=await fetch(`${supaUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,{method:'POST',headers:storageHeaders({'Content-Type':'application/json'}),body:JSON.stringify({prefix:req.params.company,limit:100,sortBy:{column:'created_at',order:'desc'}})});
    if(!r.ok)return storageError(res);const data=await r.json();res.json({configured:true,files:(Array.isArray(data)?data:[]).filter(x=>x.name&&x.id).map(x=>({name:x.name,created_at:x.created_at,size:x.metadata?.size||0}))});
  }catch(e){console.error('Storage list error',e.message);storageError(res);}
});
app.post('/api/owner/files/:company',requireOwner,requireCompany,express.raw({type:'application/octet-stream',limit:'12mb'}),async(req,res)=>{
  if(!storageReady)return res.status(503).json({error:'Configure Supabase Storage before uploading files.'});
  const name=String(req.headers['x-pal-filename']||'').trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/.test(name)||name==='.'||name==='..')return res.status(400).json({error:'Invalid filename'});
  if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Empty file'});
  const safeName=`${Date.now()}-${name}`;
  try{const url=`${supaUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${storagePath(req.params.company,encodeURIComponent(safeName))}`;
    const r=await fetch(url,{method:'POST',headers:storageHeaders({'Content-Type':'application/octet-stream','x-upsert':'false'}),body:req.body});if(!r.ok)return storageError(res);res.status(201).json({ok:true,name:safeName});
  }catch(e){console.error('Storage upload error',e.message);storageError(res);}
});
app.post('/api/owner/files/:company/link',requireOwner,requireCompany,express.json({limit:'5kb'}),async(req,res)=>{
  if(!storageReady)return res.status(503).json({error:'Storage not configured'});
  const name=req.body?.name;
  if(typeof name!=='string'||!/^\d{13}-[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/.test(name))return res.status(400).json({error:'Invalid file name'});
  try{const url=`${supaUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${storagePath(req.params.company,encodeURIComponent(name))}`;
    const r=await fetch(url,{method:'POST',headers:storageHeaders({'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:60})});if(!r.ok)return storageError(res);const data=await r.json();if(!data.signedURL)return storageError(res);res.json({url:new URL(data.signedURL,supaUrl).toString()});
  }catch(e){console.error('Storage link error',e.message);storageError(res);}
});
require('./baa-api')(app,{manager:req=>membership(req).companies.includes('born-again-air')&&(isOwner(req)||membership(req).role==='manager'),user:req=>getAuth(req).userId});
app.use(express.json({limit:'100kb'}));
app.use((_req,res)=>res.status(404).send('Page not found'));
app.listen(PORT,()=>console.log(`PAL listening on ${PORT}`));
