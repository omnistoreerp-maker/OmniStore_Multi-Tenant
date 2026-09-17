(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  function create(options){
    options=options||{};let state={customers:Object.freeze([]),health:Object.freeze([]),errors:Object.freeze([]),updates:Object.freeze([]),snapshots:Object.freeze([]),loadedAt:null};
    const snapshot=()=>Object.freeze({...state,dashboard:ns.PlatformDashboard.build(state.customers,state.health),notifications:ns.NotificationCenter.build(state.health,state.errors,state.updates),readOnly:true});
    async function refresh(){const provider=options.provider;if(!provider||typeof provider.readSnapshot!=='function')throw new Error('READ_ONLY_MONITORING_PROVIDER_REQUIRED');const raw=await provider.readSnapshot();const check=ns.PlatformOperationsValidator.validate(raw);if(!check.valid)return check;state={customers:Object.freeze(raw.customers.map(x=>Object.freeze({...x}))),health:Object.freeze(raw.health.map(ns.HealthMonitor.normalize)),errors:ns.ErrorCenter.normalize(raw.errors),updates:Object.freeze((raw.updates||[]).map(ns.UpdateCenter.preview)),snapshots:Object.freeze(raw.snapshots||[]),loadedAt:new Date().toISOString()};return snapshot();}
    return Object.freeze({refresh,snapshot,backupPreview:(kind,input)=>ns.BackupCenter.preview(kind,input),restorePreview:input=>ns.BackupCenter.preview('restore',input),updatePreview:ns.UpdateCenter.preview,rollbackPreview:ns.UpdateCenter.rollbackPreview});
  }
  ns.PlatformOperationsEngine=Object.freeze({version:'1.0.0',create});
})(typeof globalThis!=='undefined'?globalThis:window);
