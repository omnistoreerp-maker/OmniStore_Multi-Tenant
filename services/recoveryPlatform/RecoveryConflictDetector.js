(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  function detect(backup,current){backup=backup||{};current=current||{};const conflicts=[];if(backup.tenantId&&current.tenantId&&backup.tenantId!==current.tenantId)conflicts.push({code:'TENANT_MISMATCH',blocking:true});if(backup.schemaVersion&&current.schemaVersion&&backup.schemaVersion!==current.schemaVersion)conflicts.push({code:'SCHEMA_VERSION_DIFFERENCE',blocking:false});if(backup.version&&current.version&&backup.version>current.version)conflicts.push({code:'BACKUP_FROM_NEWER_VERSION',blocking:true});if(Number(backup.storageBytes||0)>Number(current.availableBytes||Infinity))conflicts.push({code:'INSUFFICIENT_STORAGE',blocking:true});return Object.freeze({conflicts:Object.freeze(conflicts),blocking:conflicts.some(x=>x.blocking),count:conflicts.length});}
  ns.RecoveryConflictDetector=Object.freeze({version:'1.0.0',detect});
})(typeof globalThis!=='undefined'?globalThis:window);
