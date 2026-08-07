(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const SIGNALS=Object.freeze(['cpu','ram','storage','database','supabase','edgeFunctions','cronJobs','api','realtime','storageBuckets','queues','workers']);
  function aggregate(values){values=values||{};const signals=Object.freeze(Object.fromEntries(SIGNALS.map(key=>[key,Object.freeze({status:values[key]?.status||'unknown',value:Number(values[key]?.value||0),unit:values[key]?.unit||'',checkedAt:values[key]?.checkedAt||null})])));const known=Object.values(signals).filter(x=>x.status!=='unknown');const healthy=known.filter(x=>x.status==='healthy'||x.status==='online').length;return Object.freeze({signals,score:known.length?Math.round(healthy/known.length*100):0,readOnly:true});}
  ns.SystemMonitoringAggregator=Object.freeze({version:'1.0.0',SIGNALS,aggregate});
})(typeof globalThis!=='undefined'?globalThis:window);
