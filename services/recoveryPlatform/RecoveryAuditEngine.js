(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};const TYPES=Object.freeze(['backupPreview','restorePreview','updateCheck','rollbackPreview','validation','healthCheck']);
  function create(){let events=[];return Object.freeze({record:value=>{if(!value||!TYPES.includes(value.type))return Object.freeze({valid:false});const event=Object.freeze({id:`recovery-audit-${events.length+1}`,type:value.type,tenantId:String(value.tenantId||''),createdAt:value.createdAt||new Date().toISOString(),executed:false,persisted:false});events=[event,...events];return Object.freeze({valid:true,event});},list:()=>Object.freeze([...events])});}
  ns.RecoveryAuditEngine=Object.freeze({version:'1.0.0',TYPES,create});
})(typeof globalThis!=='undefined'?globalThis:window);
