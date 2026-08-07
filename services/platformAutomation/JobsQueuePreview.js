(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  function normalize(values){return Object.freeze((values||[]).map(x=>Object.freeze({id:String(x.id||''),type:x.type||'unknown',tenantId:String(x.tenantId||''),status:x.status||'planned',attempts:Number(x.attempts||0),scheduledAt:x.scheduledAt||null,executed:false})));}
  ns.JobsQueuePreview=Object.freeze({version:'1.0.0',normalize,summary:values=>Object.freeze({total:values.length,planned:values.filter(x=>x.status==='planned').length,failed:values.filter(x=>x.status==='failed').length,running:0})});
})(typeof globalThis!=='undefined'?globalThis:window);
