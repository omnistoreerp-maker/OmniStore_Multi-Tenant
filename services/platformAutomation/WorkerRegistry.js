(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const workers=Object.freeze(['monitor-worker','backup-preview-worker','license-check-worker','update-check-worker','notification-preview-worker'].map((id,index)=>Object.freeze({id,slot:index+1,status:'disabled',executionEnabled:false})));
  ns.WorkerRegistry=Object.freeze({version:'1.0.0',workers,health:()=>Object.freeze({registered:workers.length,active:0,queuedExecution:false})});
})(typeof globalThis!=='undefined'?globalThis:window);
