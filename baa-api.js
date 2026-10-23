const fs=require('fs');const path=require('path');const ExcelJS=require('exceljs');const pdfParse=require('pdf-parse');
const seedCatalog=require('./data/catalog.json');const seedPrices=require('./data/prices.json');
const base=path.join(__dirname,'data','baa-runtime');fs.mkdirSync(base,{recursive:true});
const su=(process.env.SUPABASE_URL||'').replace(/\/$/,'');const sk=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';const bucket=process.env.PAL_SUPABASE_BUCKET||'pal-private-documents';const remote=!!(su&&sk);
const safeId=s=>/^[a-zA-Z0-9_-]{1,90}$/.test(s||'');
// Initialize only the two bundled reference datasets when their remote objects
// do not yet exist. Never overwrite an existing remote catalog or price list.
const seedKeys=new Set(['catalog','prices']);
const seedInFlight=new Map();
async function readRemote(key){
 const r=await fetch(`${su}/storage/v1/object/${bucket}/born-again-air/app/${key}.json`,{headers:{apikey:sk,Authorization:`Bearer ${sk}`}});
 if(r.ok)return {found:true,value:await r.json()};
 if(r.status===404)return {found:false};
 // Supabase Storage can return HTTP 400 with an Object-not-found payload.
 // Only the missing box index is allowed to fall back to the empty-list default.
 // Other 400 responses (bad credentials, bucket errors, etc.) remain visible.
 if(key==='box-index'&&r.status===400){
  const body=await r.text();
  let detail={};try{detail=JSON.parse(body);}catch(_){}
  const message=String(detail.message||'').toLowerCase();
  const error=String(detail.error||'').toLowerCase();
  if((message==='object not found'||message==='the resource was not found')&&
     (error==='not_found'||error==='not found'||String(detail.statusCode||'')==='404'))return {found:false};
  throw Error('Storage read failed 400 for box-index: '+(detail.message||detail.error||body.slice(0,160)));
 }
 throw Error('Storage read failed '+r.status+' for '+key);
}
async function initializeSeed(key,fallback){
 if(seedInFlight.has(key))return seedInFlight.get(key);
 const task=(async()=>{
  // Recheck before writing in case another request initialized the file.
  const existing=await readRemote(key);
  if(existing.found)return existing.value;
  const json=JSON.stringify(fallback);
  // No upsert: an existing object must never be replaced by bundled seed data.
  const r=await fetch(`${su}/storage/v1/object/${bucket}/born-again-air/app/${key}.json`,{
   method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json'},body:json
  });
  if(!r.ok){
   // Concurrent first-time initialization may have created the object.
   if(r.status===409){const raced=await readRemote(key);if(raced.found)return raced.value;}
   throw Error('Storage initialization failed '+r.status+' for '+key);
  }
  const verified=await readRemote(key);
  if(!verified.found||JSON.stringify(verified.value)!==json)throw Error('Storage verification failed for '+key);
  console.log('Supabase seed initialized and verified: '+key+' ('+fallback.length+' records)');
  return verified.value;
 })();
 seedInFlight.set(key,task);
 try{return await task;}finally{seedInFlight.delete(key);}
}
async function read(key,fallback){if(remote){
 const result=await readRemote(key);
 if(result.found)return result.value;
 if(seedKeys.has(key))return initializeSeed(key,fallback);
 }else{const f=path.join(base,key+'.json');if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f));}
 return structuredClone(fallback);
}
async function write(key,value){const json=JSON.stringify(value);if(remote){const r=await fetch(`${su}/storage/v1/object/${bucket}/born-again-air/app/${key}.json`,{method:'POST',headers:{apikey:sk,Authorization:`Bearer ${sk}`,'Content-Type':'application/json','x-upsert':'true'},body:json});if(!r.ok)throw Error('Storage write failed '+r.status);}else fs.writeFileSync(path.join(base,key+'.json'),json);}
async function removeStoredBox(id){
 if(remote){
  const r=await fetch(`${su}/storage/v1/object/${bucket}/born-again-air/app/box-${id}.json`,{method:'DELETE',headers:{apikey:sk,Authorization:`Bearer ${sk}`}});
  if(!r.ok&&r.status!==404)throw Error('Storage delete failed '+r.status+' for box-'+id);
 }else{
  const f=path.join(base,'box-'+id+'.json');if(fs.existsSync(f))fs.unlinkSync(f);
 }
}
const cat=()=>read('catalog',seedCatalog);const prices=()=>read('prices',seedPrices);const norm=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,'');
const num=v=>v===null||v===undefined||v===''?null:Number(v);
// The PDF catalog establishes identity (part + core). The Excel CORE BASE
// column is the price key; it may equal the PDF part number, not the PDF core.
// Resolve the catalog pair first, then look up CORE BASE by the mapped part
// number. Only fall back to mapped core if there is no mapped-part price.
function priceFor(priceRows, mappedPart, mappedCore){
 const keys=[norm(mappedPart)].filter(Boolean); // CORE BASE in the supplied buy list indexes REMAN part numbers
 let candidates=[],key='';
 for(const candidate of [...new Set(keys)]){
  const rows=priceRows.filter(x=>norm(x.coreBase)===candidate);
  if(rows.length){candidates=rows;key=candidate;break;}
 }
 const values=[...new Set(candidates.map(x=>Number(x.price)).filter(Number.isFinite))];
 return {price:values.length===1?values[0]:null,priceStatus:values.length===0?'missing':values.length>1?'ambiguous':'matched',priceMatches:candidates.length,priceCoreBase:key};
}
function lookup(rows,priceRows,q){const term=norm(q);if(!term)return {matches:[]};const matches=rows.filter(r=>norm(r.part)===term||norm(r.core)===term).slice(0,50);return {matches:matches.map(r=>({...r,...priceFor(priceRows,r.part,r.core)})),duplicate:matches.length>1};}
function boxRows(b){return (b.items||[]).map(x=>({...x,extended:b.type==='core-receiving'?null:Number.isFinite(x.price)?Math.round(x.price*x.qty*100)/100:null}));}
function summary(b){const rows=boxRows(b);return {...b,items:rows,totalQty:rows.reduce((a,x)=>a+x.qty,0),pricedTotal:b.type==='core-receiving'?(b.receivingTotal??0):rows.reduce((a,x)=>a+(x.extended||0),0),unpriced:b.type==='core-receiving'?0:rows.filter(x=>x.extended===null).length};}
function parseCatalogText(text){const out=[];const seen=new Set();for(const line of text.split(/\r?\n/)){const m=line.trim().match(/^(\d{4,8})\s+(?:No New|\d{4,8})\s+(\d{4,12})(?:\s|$)/i);if(!m)continue;const k=m[1]+'|'+m[2];if(!seen.has(k)){seen.add(k);out.push({part:m[1],core:m[2]});}}return out;}
function parsePriceSheet(wb){const sh=wb.worksheets[0];if(!sh)throw Error('Workbook has no sheet');let hdr=0,part=0,core=0,price=0;for(let i=1;i<=Math.min(sh.rowCount,25);i++){const row=sh.getRow(i);const cells=row.values.map(v=>norm(typeof v==='object'?v?.text??v?.result??'':v));part=cells.indexOf('BASEPN');core=cells.indexOf('COREBASE');price=cells.indexOf('PRICE');if(part>0&&core>0&&price>0){hdr=i;break;}}if(!hdr)throw Error('Expected BASE PN, CORE BASE and PRICE columns');const rows=[];for(let i=hdr+1;i<=sh.rowCount;i++){const row=sh.getRow(i);const p=norm(row.getCell(part).value),c=norm(row.getCell(core).value);const val=row.getCell(price).value;const n=Number(typeof val==='object'?val?.result:val);if((p||c)&&Number.isFinite(n)&&val!==null&&val!=='')rows.push({basePart:p,coreBase:c,price:n,sourceRow:i});}return rows;}
module.exports=function(app,auth){const json=require('express').json({limit:'1mb'});const manager=(req,res,next)=>{if(!auth.manager(req))return res.status(403).json({error:'Born Again Air manager access required'});next();};
app.get('/api/baa/status',manager,async(req,res)=>{try{const [c,p,index]=await Promise.all([cat(),prices(),read('box-index',[])]);res.json({catalog:c.length,prices:p.length,boxes:index.length,persistent:remote,warning:remote?null:'Local storage is temporary on Render. Configure Supabase Storage for persistence.'});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/baa/lookup',manager,async(req,res)=>{try{res.json(lookup(await cat(),await prices(),req.query.q));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/baa/catalog',manager,async(req,res)=>{try{const rows=await cat();res.json({count:rows.length,rows:rows.filter(x=>!req.query.q||norm(x.part).includes(norm(req.query.q))||norm(x.core).includes(norm(req.query.q))).slice(Math.max(0,Number(req.query.offset)||0),Math.max(0,Number(req.query.offset)||0)+100).map(x=>({...x,index:rows.indexOf(x)}))});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/baa/prices',manager,async(req,res)=>{try{const rows=await prices(),q=norm(req.query.q);const filtered=rows.map((x,index)=>({...x,index})).filter(x=>!q||norm(x.basePart).includes(q)||norm(x.coreBase).includes(q));res.json({count:filtered.length,rows:filtered.slice(Math.max(0,Number(req.query.offset)||0),Math.max(0,Number(req.query.offset)||0)+100)});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/baa/prices/row',manager,json,async(req,res)=>{try{const rows=await prices(),i=Number(req.body.index),basePart=norm(req.body.basePart),coreBase=norm(req.body.coreBase),price=num(req.body.price);if(!basePart&&!coreBase)return res.status(400).json({error:'Part or core number required'});if(!Number.isFinite(price)||price<0)return res.status(400).json({error:'Valid price required'});if(basePart.length>60||coreBase.length>60)return res.sendStatus(400);if(Number.isInteger(i)&&i>=0&&i<rows.length)rows[i]={...rows[i],basePart,coreBase,price};else rows.push({basePart,coreBase,price});await write('prices',rows);res.json({ok:true,count:rows.length});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/baa/catalog/row',manager,json,async(req,res)=>{try{const part=norm(req.body.part),core=norm(req.body.core);if(!part&&!core)return res.status(400).json({error:'Provide at least one number'});if(part.length>60||core.length>60)return res.status(400).json({error:'Number too long'});const rows=await cat();const old=Number(req.body.index);if(Number.isInteger(old)&&old>=0&&old<rows.length)rows[old]={part,core};else rows.push({part,core});await write('catalog',rows);res.json({ok:true,count:rows.length});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/baa/catalog/upload',manager,require('express').raw({type:['application/pdf','application/octet-stream'],limit:'15mb'}),async(req,res)=>{try{if(!Buffer.isBuffer(req.body)||req.body.subarray(0,4).toString()!=='%PDF')return res.status(400).json({error:'Upload a PDF file'});const parsed=await pdfParse(req.body);const rows=parseCatalogText(parsed.text);if(rows.length<2)return res.status(422).json({error:'Unable to recognize part/core columns in this PDF. Existing database unchanged.'});await write('catalog',rows);res.json({ok:true,count:rows.length});}catch(e){res.status(422).json({error:e.message});}});
app.post('/api/baa/prices/upload',manager,require('express').raw({type:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],limit:'12mb'}),async(req,res)=>{try{const wb=new ExcelJS.Workbook();await wb.xlsx.load(req.body);const rows=parsePriceSheet(wb);if(!rows.length)return res.status(422).json({error:'No valid price rows; old prices preserved'});await write('prices',rows);res.json({ok:true,count:rows.length});}catch(e){res.status(422).json({error:e.message});}});
app.get('/api/baa/boxes',manager,async(req,res)=>{try{const ids=await read('box-index',[]);const all=await Promise.all(ids.map(id=>read('box-'+id,null)));res.json(all.filter(Boolean).map(b=>({id:b.id,name:b.name,type:b.type,status:b.status,updatedAt:b.updatedAt,totalQty:summary(b).totalQty,pricedTotal:summary(b).pricedTotal,unpriced:summary(b).unpriced})).reverse());}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/baa/boxes',manager,json,async(req,res)=>{try{const type=req.body.type;if(!['core-shipping','compressor-shipping','core-receiving'].includes(type))return res.status(400).json({error:'Invalid type'});const id=require('crypto').randomUUID();const b={id,name:String(req.body.name||type).slice(0,100),type,status:'draft',receivingTotal:null,items:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:auth.user(req)};await write('box-'+id,b);const ids=await read('box-index',[]);ids.push(id);await write('box-index',ids);res.status(201).json(summary(b));}catch(e){res.status(500).json({error:e.message});}});
// Manager-only deletion; the index is updated before removing the stored box.
app.delete('/api/baa/boxes/:id',manager,async(req,res)=>{try{
 const id=req.params.id;if(!safeId(id))return res.sendStatus(400);
 const ids=await read('box-index',[]);
 if(!ids.includes(id))return res.status(404).json({error:'Saved box not found'});
 const box=await read('box-'+id,null);
 if(!box)return res.status(404).json({error:'Saved box not found'});
 await write('box-index',ids.filter(x=>x!==id));
 await removeStoredBox(id);
 res.json({ok:true,deleted:id});
 }catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/baa/boxes/:id',manager,async(req,res)=>{if(!safeId(req.params.id))return res.sendStatus(400);const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);res.json(summary(b));});
app.post('/api/baa/boxes/:id/items',manager,json,async(req,res)=>{try{const id=req.params.id;if(!safeId(id))return res.sendStatus(400);const b=await read('box-'+id,null);if(!b)return res.sendStatus(404);if(b.status!=='draft')return res.status(409).json({error:'Finished boxes cannot be edited'});const part=norm(req.body.part),core=norm(req.body.core),qty=Number(req.body.qty);if(!part&&!core)return res.status(400).json({error:'Enter a part or core number'});if(!Number.isSafeInteger(qty)||qty<1||qty>100000)return res.status(400).json({error:'Invalid quantity'});const matches=lookup(await cat(),b.type==='core-receiving'?[]:await prices(),part||core).matches.filter(x=>(!part||norm(x.part)===part)&&(!core||norm(x.core)===core));if(matches.length>1)return res.status(409).json({error:'Duplicate/ambiguous database match. Resolve before adding.'});if(matches.length===0)return res.status(422).json({error:'Number not found in Born Again Air database. Add or correct the record first.'});if(matches.length===1){const m=matches[0];if(m.priceStatus==='ambiguous')return res.status(409).json({error:'Ambiguous price. Correct price sheet before adding.'});}const row=matches[0]||null;const p=part||row?.part||'',c=core||row?.core||'';const pricesRows=b.type==='core-receiving'?[]:await prices();const resolved=priceFor(pricesRows,p,c);if(resolved.priceStatus==='ambiguous')return res.status(409).json({error:'Conflicting prices for CORE BASE '+resolved.priceCoreBase+'. Manager review required.'});if(b.type==='core-shipping'&&resolved.priceStatus!=='matched')return res.status(422).json({error:'NOT ON PRICE SHEET — HOLD ASIDE. Print the label; do not add this core to a shipping box.'});const isCompressor=b.type==='compressor-shipping';
 const coreCharge=isCompressor?req.body.coreCharge:null;
 if(isCompressor&&typeof coreCharge!=='boolean')return res.status(400).json({error:'Choose Core Charge: Yes or No for compressor shipping.'});
 if(isCompressor&&coreCharge&&resolved.priceStatus!=='matched')return res.status(422).json({error:'Core charge price missing. Update the core price sheet before adding this compressor.'});
 const charge=isCompressor?(coreCharge?resolved.price:0):null;
 const price=b.type==='core-receiving'?null:isCompressor?Math.round((65.5+charge)*100)/100:resolved.price;
 const sameIdentity=b.items.filter(x=>norm(x.part)===p&&norm(x.core)===c&&(!isCompressor||Boolean(x.coreChargeApplied)===coreCharge));
 // One physical part/core pair is one line. Never silently change a recorded
 // non-null price: if prices differ, ask the manager to review the saved box.
 if(sameIdentity.some(x=>x.price!==null&&price!==null&&x.price!==price))return res.status(409).json({error:'This item already exists at a different saved price. Review the box before adding more.'});
 const existing=sameIdentity[0];
 if(existing){existing.qty+=qty;if(existing.price===null&&price!==null)existing.price=price;
  for(const extra of sameIdentity.slice(1)){existing.qty+=extra.qty;b.items=b.items.filter(x=>x.id!==extra.id);}
 }else b.items.push({id:require('crypto').randomUUID(),part:p,core:c,qty,price,...(isCompressor?{basePrice:65.5,coreChargeApplied:coreCharge,coreCharge:charge}:{})});b.audit=b.audit||[];b.audit.push({action:'add',part:p,core:c,qty,by:auth.user(req),at:new Date().toISOString()});b.updatedAt=new Date().toISOString();await write('box-'+id,b);res.json(summary(b));}catch(e){res.status(500).json({error:e.message});}});
// Editing a finished box requires explicit reopening and is recorded in its audit history.
app.post('/api/baa/boxes/:id/reopen',manager,json,async(req,res)=>{try{if(!safeId(req.params.id))return res.sendStatus(400);const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);if(b.status!=='finished')return res.status(409).json({error:'Box is not finished'});b.audit=b.audit||[];b.audit.push({action:'reopen',by:auth.user(req),at:new Date().toISOString()});b.status='draft';b.updatedAt=new Date().toISOString();await write('box-'+b.id,b);res.json(summary(b));}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/baa/boxes/:id',manager,json,async(req,res)=>{try{if(!safeId(req.params.id))return res.sendStatus(400);const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);if(b.status!=='draft')return res.status(409).json({error:'Reopen finished box before editing'});if(b.type==='core-receiving'&&Object.prototype.hasOwnProperty.call(req.body,'receivingTotal')){const v=num(req.body.receivingTotal);if(v!==null&&(!Number.isFinite(v)||v<0))return res.status(400).json({error:'Enter a valid total dollar amount'});b.audit=b.audit||[];b.audit.push({action:'receiving-total',from:b.receivingTotal??null,to:v,by:auth.user(req),at:new Date().toISOString()});b.receivingTotal=v;b.updatedAt=new Date().toISOString();await write('box-'+b.id,b);return res.json(summary(b));}const name=String(req.body.name||'').trim();if(!name||name.length>100)return res.status(400).json({error:'Box name required (max 100 characters)'});b.audit=b.audit||[];b.audit.push({action:'rename',from:b.name,to:name,by:auth.user(req),at:new Date().toISOString()});b.name=name;b.updatedAt=new Date().toISOString();await write('box-'+b.id,b);res.json(summary(b));}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/baa/boxes/:id/items/:item',manager,json,async(req,res)=>{try{if(!safeId(req.params.id))return res.sendStatus(400);const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);if(b.status!=='draft')return res.status(409).json({error:'Reopen finished box before editing'});const x=b.items.find(x=>x.id===req.params.item);if(!x)return res.sendStatus(404);const qty=Number(req.body.qty);if(!Number.isSafeInteger(qty)||qty<1||qty>100000)return res.status(400).json({error:'Invalid quantity'});b.audit=b.audit||[];b.audit.push({action:'quantity',item:x.id,from:x.qty,to:qty,by:auth.user(req),at:new Date().toISOString()});x.qty=qty;b.updatedAt=new Date().toISOString();await write('box-'+b.id,b);res.json(summary(b));}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/baa/boxes/:id/items/:item',manager,async(req,res)=>{const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);if(b.status!=='draft')return res.sendStatus(409);b.audit=b.audit||[];b.audit.push({action:'remove',item:req.params.item,by:auth.user(req),at:new Date().toISOString()});b.items=b.items.filter(x=>x.id!==req.params.item);b.updatedAt=new Date().toISOString();await write('box-'+b.id,b);res.json(summary(b));});
app.post('/api/baa/boxes/:id/finish',manager,async(req,res)=>{const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);if(!b.items.length)return res.status(400).json({error:'Box is empty'});if(['core-shipping','compressor-shipping'].includes(b.type)&&b.items.some(x=>x.price===null||x.price===undefined))return res.status(409).json({error:'Unpriced cores cannot be shipped. Remove and label them for HOLD ASIDE.'});if(b.type!=='core-receiving'&&b.items.some(x=>x.price===null)&&!req.body?.acknowledgeUnpriced)return res.status(409).json({error:'Some items have no price. Confirm explicitly before finishing.'});b.status='finished';b.finishedBy=auth.user(req);b.finishedAt=new Date().toISOString();b.updatedAt=b.finishedAt;await write('box-'+b.id,b);res.json(summary(b));});
app.get('/api/baa/boxes/:id/export',manager,async(req,res)=>{try{
 const b=await read('box-'+req.params.id,null);if(!b)return res.sendStatus(404);
 const wb=new ExcelJS.Workbook();const sh=wb.addWorksheet('Buy List');
 for(const [col,title] of (b.type==='compressor-shipping'?[['A','Core Number'],['C','Part Number'],['E','Qty'],['G','Price Per Unit'],['I','Core Charge'],['K','Total Price']]:[['A','Core Number'],['C','Part Number'],['E','Qty'],['G','Price Per Unit'],['I','Total Price']]))sh.getCell(col+'1').value=title;
 for(const [col,width] of [['A',20],['B',5],['C',20],['D',5],['E',12],['F',5],['G',20],['H',5],['I',20],['J',5],['K',20]])sh.getColumn(col).width=width;
 for(const col of (b.type==='compressor-shipping'?['A','C','E','G','I','K']:['A','C','E','G','I'])){const c=sh.getCell(col+'1');c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142743'}};c.alignment={vertical:'middle'};}
 sh.getRow(1).height=23;const money='"$"#,##0.00';
 [...b.items].sort((a,b)=>{const x=String(a.core??""),y=String(b.core??"");return x.localeCompare(y,undefined,{numeric:true,sensitivity:"base"});}).forEach((x,i)=>{const n=i+2;sh.getCell(`A${n}`).value=x.core||null;sh.getCell(`C${n}`).value=x.part||null;sh.getCell(`E${n}`).value=x.qty;
  if(b.type!=='core-receiving'&&x.price!==null&&x.price!==undefined){const unit=Number(x.price);if(b.type==='compressor-shipping'){const base=Number(x.basePrice??65.5),charge=Number(x.coreCharge??Math.max(0,unit-base));sh.getCell(`G${n}`).value=base;sh.getCell(`I${n}`).value=charge;sh.getCell(`K${n}`).value={formula:`E${n}*(G${n}+I${n})`,result:Number(x.qty)*(base+charge)};}else{sh.getCell(`G${n}`).value=unit;sh.getCell(`I${n}`).value={formula:`E${n}*G${n}`,result:Number(x.qty)*unit};}}
  sh.getCell(`G${n}`).numFmt=money;sh.getCell(`I${n}`).numFmt=money;sh.getCell(`K${n}`).numFmt=money;
 });
 // Three completely blank rows between the final item and the totals row.
 const t=b.items.length+5;sh.getCell(`C${t}`).value='TOTAL';
 sh.getCell(`E${t}`).value={formula:`SUM(E2:E${t-1})`,result:b.items.reduce((sum,x)=>sum+Number(x.qty||0),0)};
 sh.getCell(`${b.type==='compressor-shipping'?'K':'I'}${t}`).value=b.type==='core-receiving'?(b.receivingTotal??null):{formula:`SUM(${b.type==='compressor-shipping'?'K':'I'}2:${b.type==='compressor-shipping'?'K':'I'}${t-1})`,result:b.items.reduce((sum,x)=>sum+(x.price===null||x.price===undefined?0:Number(x.qty)*Number(x.price)),0)};
 sh.getCell(`${b.type==='compressor-shipping'?'K':'I'}${t}`).numFmt=money;sh.getCell(`${b.type==='compressor-shipping'?'K':'I'}${t}`).font={bold:true,underline:'double'};sh.getCell(`C${t}`).font={bold:true};sh.getCell(`E${t}`).font={bold:true};
 const missing=b.type!=='core-receiving'&&b.items.some(x=>x.price===null||x.price===undefined);
 if(missing)sh.getCell(`A${t+2}`).value='WARNING: Missing prices; total excludes unpriced items.';
 sh.views=[{state:'frozen',ySplit:1}];sh.pageSetup={fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:${b.type==='compressor-shipping'?'K':'I'}${missing?t+2:t}`};
 const data=await wb.xlsx.writeBuffer();res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="BAA-${b.type}-${b.id.slice(0,8)}.xlsx"`});res.send(Buffer.from(data));
 }catch(e){res.status(500).json({error:e.message});}});
};
