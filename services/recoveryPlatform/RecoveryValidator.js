(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  function validate(backup){backup=backup||{};const checks=Object.freeze({id:Boolean(backup.id),tenantScope:Boolean(backup.tenantId),checksum:Boolean(backup.checksum),manifest:Boolean(backup.manifest),createdAt:Boolean(backup.createdAt),verified:backup.status==='verified'});const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);return Object.freeze({valid:failed.length===0,checks,failed:Object.freeze(failed),readOnly:true});}
  ns.RecoveryValidator=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
