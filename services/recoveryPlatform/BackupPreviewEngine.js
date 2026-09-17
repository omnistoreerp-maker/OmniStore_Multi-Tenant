(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  const TYPES=Object.freeze(['local','cloud','database','assets','configuration','users','licenses','fullWorkspace']);
  const CONTENT=Object.freeze({local:['workspace-data','settings'],cloud:['workspace-data','assets'],database:['schema-metadata','table-data'],assets:['logos','attachments','exports'],configuration:['business-profile','module-settings'],users:['user-profiles','role-assignments'],licenses:['license-metadata'],fullWorkspace:['database','assets','configuration','users','licenses']});
  function preview(type,input){input=input||{};if(!TYPES.includes(type))return Object.freeze({valid:false,error:'UNSUPPORTED_BACKUP_TYPE'});const size=Number(input.estimatedBytes||0);return Object.freeze({valid:true,type,tenantId:String(input.tenantId||''),contents:Object.freeze(CONTENT[type]),estimatedBytes:Math.max(0,size),destination:type==='local'?'local-preview':type==='cloud'?'cloud-preview':'recovery-preview',steps:Object.freeze(['validate scope','enumerate content','estimate size','calculate checksums','verify recovery policy']),executed:false,filesWritten:0,databaseWrites:0,previewOnly:true});}
  ns.BackupPreviewEngine=Object.freeze({version:'1.0.0',TYPES,CONTENT,preview});
})(typeof globalThis!=='undefined'?globalThis:window);
