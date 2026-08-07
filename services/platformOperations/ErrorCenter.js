(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  const CATEGORIES=Object.freeze(['application','deployment','provision','authentication','database','edgeFunction','browser']);
  function normalize(values){return Object.freeze((values||[]).filter(x=>CATEGORIES.includes(x.category)).map(x=>Object.freeze({id:String(x.id||''),tenantId:String(x.tenantId||''),category:x.category,severity:x.severity||'medium',message:String(x.message||''),occurredAt:x.occurredAt||null,resolved:Boolean(x.resolved)})));}
  ns.ErrorCenter=Object.freeze({version:'1.0.0',CATEGORIES,normalize,summary:values=>Object.freeze(CATEGORIES.reduce((out,key)=>({...out,[key]:values.filter(x=>x.category===key).length}),{}))});
})(typeof globalThis!=='undefined'?globalThis:window);
