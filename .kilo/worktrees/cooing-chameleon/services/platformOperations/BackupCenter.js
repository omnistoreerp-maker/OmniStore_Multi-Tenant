(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  function plan(input){
    input=input||{};
    return Object.freeze({tenantId:String(input.tenantId||''),frequency:input.frequency||'daily',time:input.time||'02:00',retentionDays:Math.max(1,Number(input.retentionDays||30)),includeStorage:input.includeStorage!==false,enabled:input.enabled!==false,executionEnabled:false});
  }
  function preview(kind,input){
    const value=plan(input);
    return Object.freeze({kind,plan:value,steps:Object.freeze(['validate tenant scope','estimate snapshot size','verify retention policy','create server-side backup job','verify checksum']),executed:false,writes:0,previewOnly:true});
  }
  function verify(snapshot){return Object.freeze({valid:Boolean(snapshot&&snapshot.id&&snapshot.checksum&&snapshot.status==='verified'),snapshotId:snapshot&&snapshot.id||null,readOnly:true});}
  ns.BackupCenter=Object.freeze({version:'1.0.0',plan,preview,verify,retention:days=>Object.freeze({keepDaily:Math.min(30,days),keepWeekly:Math.min(12,Math.ceil(days/7)),keepMonthly:Math.min(24,Math.ceil(days/30))})});
})(typeof globalThis!=='undefined'?globalThis:window);
