'use strict';
const express=require('express');const a=require('./core');const worker=require('./worker');const scheduler=require('./schedule');const vendors=require('./vendor-scheduler');
module.exports=function(app,requireOwner){
 const router=express.Router();router.use(requireOwner);router.use(express.json({limit:'8kb'}));
 router.get('/status',async(req,res)=>{try{const tenant=req.query.tenant||'born-again-air';if(!['born-again-air','newstart'].includes(tenant))return res.status(400).json({error:'Invalid tenant'});res.set('Cache-Control','no-store');const [setting,jobs]=await Promise.all([a.setting(tenant),a.listJobs(tenant)]);const summary={};for(const j of jobs||[])summary[j.status]=(summary[j.status]||0)+1;res.json({tenant,enabled:setting.enabled,xaiConfigured:Boolean(process.env.XAI_API_KEY),databaseConfigured:a.configured(),roles:a.ROLES,jobs,visibleJobSummary:summary,readerExecutionEnabled:process.env.PAL_READER_EXECUTION==='true'});}catch(e){console.error('Automation status:',e.message);res.status(503).json({error:'Automation database unavailable; apply SQL setup and verify environment configuration.'});}});
 router.post('/enabled',async(req,res)=>{try{const tenant=req.body?.tenant;const enabled=req.body?.enabled;if(!['born-again-air','newstart'].includes(tenant)||typeof enabled!=='boolean')return res.status(400).json({error:'Invalid request'});await a.setEnabled(tenant,enabled);await a.event(tenant,null,enabled?'automation_enabled':'automation_paused');res.json({ok:true,tenant,enabled});}catch(e){console.error('Automation toggle:',e.message);res.status(503).json({error:'Could not update automation setting'});}});
 app.use('/api/owner/automation',router);
 // Scheduler is separate from owner session. Strict secret and no financial writes.
 app.post('/api/internal/scheduler/tick',async(req,res)=>{
  if(!a.schedulerSecret(req))return res.status(403).json({error:'Forbidden'});
  try{
   const plan=await scheduler.schedule();
   if(plan.paused)return res.json({ok:true,...plan});
   // Expose exhausted retries; do not leave expired jobs marked running forever.
   const recovered={};const work={};const vendorReviews={};
   for(const tenant of ['born-again-air','newstart']){
    if(plan[tenant]?.paused)continue;
    recovered[tenant]=await a.db('rpc/pal_recover_exhausted_jobs',{method:'POST',body:{p_tenant:tenant}});
    vendorReviews[tenant]=await vendors.enqueueDue(tenant,plan[tenant].day);
    work[tenant]=await worker.runOnce(tenant);
   }
   res.json({ok:true,...plan,recovered,vendorReviews,work});
  }catch(e){console.error('Scheduler tick:',e.message);res.status(503).json({error:'Scheduler failed; retry safely'});}
 });
};
