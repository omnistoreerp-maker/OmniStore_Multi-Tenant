(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  function check(input,now){input=input||{};const age=input.lastBackupAt?Math.max(0,Math.floor((new Date(now||Date.now())-new Date(input.lastBackupAt))/86400000)):null;const checks=Object.freeze({backupFresh:age!==null&&age<=Number(input.maxBackupAgeDays||7),storageHealthy:Number(input.storageUsage||0)<90,backupIntegrity:input.backupIntegrity==='verified',versionIntegrity:input.versionIntegrity==='verified',migrationIntegrity:input.migrationIntegrity==='verified',configurationIntegrity:input.configurationIntegrity==='verified'});const passed=Object.values(checks).filter(Boolean).length;return Object.freeze({backupAgeDays:age,storageUsage:Number(input.storageUsage||0),checks,score:Math.round(passed/6*100),healthy:passed===6,readOnly:true});}
  ns.RecoveryHealthEngine=Object.freeze({version:'1.0.0',check});
})(typeof globalThis!=='undefined'?globalThis:window);
