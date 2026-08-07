(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};
  function analyze(data){const products=data&&data.products||[],low=products.filter(x=>Number(x.stock||0)<=Number(x.minStock||0)),dead=products.filter(x=>Number(x.stock||0)>0&&Number(x.soldQty||0)===0),fast=[...products].sort((a,b)=>Number(b.soldQty||0)-Number(a.soldQty||0)).slice(0,10),prediction=products.map(x=>Object.freeze({id:x.id,name:x.name,daysCover:Number(x.dailyDemand||0)>0?Math.floor(Number(x.stock||0)/Number(x.dailyDemand)):null,reorderSuggested:Number(x.stock||0)<=Number(x.minStock||0)}));return Object.freeze({lowStock:Object.freeze(low),deadStock:Object.freeze(dead),fastMoving:Object.freeze(fast),predictions:Object.freeze(prediction),writes:0,readOnly:true});}
  ns.InventoryInsightEngine=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
