(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  const parts=value=>String(value||'0.0.0').replace(/^v/,'').split('.').map(Number);
  function compare(a,b){const x=parts(a),y=parts(b);for(let i=0;i<3;i+=1){if((x[i]||0)!==(y[i]||0))return (x[i]||0)<(y[i]||0)?-1:1;}return 0;}
  function preview(input){
    input=input||{};const available=compare(input.currentVersion,input.availableVersion)<0;
    return Object.freeze({tenantId:String(input.tenantId||''),currentVersion:input.currentVersion||'unknown',availableVersion:input.availableVersion||'unknown',workspaceVersion:input.workspaceVersion||input.currentVersion||'unknown',migrationVersion:input.migrationVersion||'unknown',releaseNotes:Object.freeze(input.releaseNotes||[]),updateAvailable:available,steps:Object.freeze(['compatibility check','backup verification','migration preview','application update preview','health verification']),executed:false,rollbackExecuted:false});
  }
  ns.UpdateCenter=Object.freeze({version:'1.0.0',compare,preview,rollbackPreview:value=>Object.freeze({tenantId:value.tenantId,from:value.availableVersion,to:value.currentVersion,requiresVerifiedBackup:true,executed:false})});
})(typeof globalThis!=='undefined'?globalThis:window);
