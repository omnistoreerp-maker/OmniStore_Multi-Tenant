(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  function browse(values,filter){filter=filter||{};return Object.freeze((values||[]).filter(x=>(!filter.tenantId||x.tenantId===filter.tenantId)&&(!filter.type||x.type===filter.type)).map(x=>Object.freeze({id:x.id,tenantId:x.tenantId,type:x.type,createdAt:x.createdAt,size:Number(x.size||0),status:x.status||'unknown',checksum:x.checksum?'available':'missing',readOnly:true})));}
  ns.SnapshotBrowser=Object.freeze({version:'1.0.0',browse});
})(typeof globalThis!=='undefined'?globalThis:window);
