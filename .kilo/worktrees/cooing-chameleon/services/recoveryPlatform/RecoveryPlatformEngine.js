(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  function create(options){options=options||{};const audit=ns.RecoveryAuditEngine.create();let state={snapshots:Object.freeze([]),versions:ns.VersionManager.normalize(),health:null,rollbackHistory:Object.freeze([]),loadedAt:null};const snapshot=()=>Object.freeze({...state,audit:Object.freeze(audit.list()),readOnly:true});
    async function refresh(){if(!options.provider||typeof options.provider.readSnapshot!=='function')throw new Error('READ_ONLY_RECOVERY_PROVIDER_REQUIRED');const raw=await options.provider.readSnapshot();state={snapshots:Object.freeze(raw.snapshots||[]),versions:ns.VersionManager.normalize(raw.versions),health:ns.RecoveryHealthEngine.check(raw.health),rollbackHistory:Object.freeze(raw.rollbackHistory||[]),loadedAt:new Date().toISOString()};return snapshot();}
    function backup(type,input){const value=ns.BackupPreviewEngine.preview(type,input);audit.record({type:'backupPreview',tenantId:input&&input.tenantId});return value;}function restore(backup,current,opts){const value=ns.RestorePreviewEngine.preview(backup,current,opts);audit.record({type:'restorePreview',tenantId:backup&&backup.tenantId});return value;}function update(input){const value=ns.UpdatePreviewEngine.preview(input);audit.record({type:'updateCheck',tenantId:input&&input.tenantId});return value;}
    return Object.freeze({refresh,snapshot,backupPreview:backup,restorePreview:restore,updatePreview:update,browseSnapshots:filter=>ns.SnapshotBrowser.browse(state.snapshots,filter),report:(type,data)=>ns.RecoveryReportBuilder.build(type,data||snapshot())});
  }
  ns.RecoveryPlatformEngine=Object.freeze({version:'1.0.0',create});
})(typeof globalThis!=='undefined'?globalThis:window);
