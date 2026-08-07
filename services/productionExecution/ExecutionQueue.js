(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function create(){let items=[];const snapshot=()=>Object.freeze(items.map(x=>Object.freeze({...x})));return Object.freeze({enqueue:request=>{const item=Object.freeze({...request,status:'pending',attempts:0});items=[...items,item];return item;},replace:(id,patch)=>{items=items.map(x=>x.requestId===id?Object.freeze({...x,...patch}):x);return snapshot();},get:id=>items.find(x=>x.requestId===id)||null,list:snapshot,pending:()=>Object.freeze(items.filter(x=>x.status==='pending'))});}
  ns.ExecutionQueue=Object.freeze({version:'1.0.0',create});
})(typeof globalThis!=='undefined'?globalThis:window);
