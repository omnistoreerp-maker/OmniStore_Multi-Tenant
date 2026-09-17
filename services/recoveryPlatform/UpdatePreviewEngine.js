(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  const parts=v=>String(v||'0.0.0').replace(/^v/,'').split('.').map(Number);
  function compareVersions(a,b){const x=parts(a),y=parts(b);for(let i=0;i<3;i+=1){if((x[i]||0)!==(y[i]||0))return(x[i]||0)<(y[i]||0)?-1:1;}return 0;}
  function preview(input){input=input||{};const available=compareVersions(input.installedVersion,input.latestVersion)<0,compatible=input.compatible!==false;return Object.freeze({installedVersion:input.installedVersion||'unknown',latestVersion:input.latestVersion||'unknown',updateAvailable:available,releaseNotes:Object.freeze(input.releaseNotes||[]),compatibility:Object.freeze({compatible,reasons:Object.freeze(input.compatibilityReasons||[])}),requiredMigrationPreview:Object.freeze(input.requiredMigrations||[]),backupRequired:Boolean(available),rollbackAvailable:Boolean(input.rollbackTarget),rollbackTarget:input.rollbackTarget||null,steps:Object.freeze(['check release metadata','verify compatibility','preview migrations','require verified backup','prepare rollback target']),executed:false,sqlExecuted:0,previewOnly:true});}
  ns.UpdatePreviewEngine=Object.freeze({version:'1.0.0',compareVersions,preview});
})(typeof globalThis!=='undefined'?globalThis:window);
