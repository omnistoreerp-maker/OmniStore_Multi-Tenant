(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  function customers(data){const values=data&&data.customers||[];return Object.freeze({total:values.length,inactive:Object.freeze(values.filter(x=>!x.lastActivity||Date.now()-new Date(x.lastActivity).getTime()>90*86400000)),top:Object.freeze([...values].sort((a,b)=>Number(b.totalSpent||0)-Number(a.totalSpent||0)).slice(0,10)),modified:0});}
  function suppliers(data){const totals={};(data&&data.purchases||[]).forEach(x=>{totals[x.supplierId]=(totals[x.supplierId]||0)+Number(x.total||0);});return Object.freeze({total:(data&&data.suppliers||[]).length,ranking:Object.freeze(Object.entries(totals).map(([supplierId,total])=>Object.freeze({supplierId,total})).sort((a,b)=>b.total-a.total)),modified:0});}
  ns.CustomerSupplierInsightEngine=Object.freeze({version:'1.0.0',customers,suppliers});
})(typeof globalThis!=='undefined'?globalThis:window);
