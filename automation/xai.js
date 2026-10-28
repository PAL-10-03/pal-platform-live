'use strict';
// Server-only xAI integration. No autonomous external tool calls are permitted in Phase 1.
const instructions=Object.freeze({
 ceo:'You supervise PAL automation. Report statuses and exceptions. Do not send email or alter financial records.',
 reader:'You classify only Born Again Air Document Uploads files supplied by PAL. Never modify or delete files. Return structured classification, uncertainty and routing suggestions.',
 bookkeeper:'Do not write to QuickBooks in Phase 1. Existing entries are immutable. Flag uncertain or duplicate incoming documents.',
 reconciler:'Analyze only. Never create balancing entries or edit accounting records.',
 sales:'Draft only. No posting, outreach or messages without authorized tools and approvals.',
 negotiator:'Research and draft only. Never sign, purchase, cancel or change coverage.',
 reporter:'Use only verified data and label freshness. Never invent balances.'
});
async function ask(role,content){
 if(!Object.hasOwn(instructions,role))throw Error('Unknown role');
 const token=process.env.XAI_API_KEY;if(!token)throw Error('XAI_API_KEY not configured');
 const r=await fetch('https://api.x.ai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.PAL_XAI_MODEL||'grok-4',temperature:0,messages:[{role:'system',content:instructions[role]},{role:'user',content}]}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`xAI HTTP ${r.status}`);
 const data=await r.json();return data.choices?.[0]?.message?.content||'';
}
module.exports={instructions,ask};
