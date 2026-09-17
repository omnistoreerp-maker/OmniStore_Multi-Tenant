(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  const TYPES=Object.freeze(['licenseExpiration','workspaceOffline','databaseFailure','storageFull','backupFailure','provisionFailure','updateAvailable']);
  function build(workspaces,errors,updates){const items=[];(workspaces||[]).forEach(w=>{if(w.connectionStatus!=='online')items.push({type:'workspaceOffline',tenantId:w.tenantId});if(w.storageUsage>=90)items.push({type:'storageFull',tenantId:w.tenantId});if(w.apiHealth==='failed')items.push({type:'databaseFailure',tenantId:w.tenantId});});(errors||[]).filter(e=>['backup','provision'].includes(e.category)).forEach(e=>items.push({type:e.category==='backup'?'backupFailure':'provisionFailure',tenantId:e.tenantId}));(updates||[]).filter(u=>u.updateAvailable).forEach(u=>items.push({type:'updateAvailable',tenantId:u.tenantId}));return Object.freeze({items:Object.freeze(items),sent:0,previewOnly:true});}
  ns.NotificationCenter=Object.freeze({version:'1.0.0',TYPES,build});
})(typeof globalThis!=='undefined'?globalThis:window);
