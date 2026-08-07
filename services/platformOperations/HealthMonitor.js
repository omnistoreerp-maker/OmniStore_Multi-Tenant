(function(root){
  'use strict';
  const ns=root.OmniPlatformOperations=root.OmniPlatformOperations||{};
  const METRICS=Object.freeze(['cpuUsage','memoryUsage','storageUsage','databaseSize','workspaceHealth','apiHealth','edgeFunctionHealth','realtimeHealth','storageHealth','connectionStatus']);
  function normalize(input){
    input=input||{};
    const percent=value=>Math.max(0,Math.min(100,Number(value||0)));
    return Object.freeze({
      tenantId:String(input.tenantId||''),businessName:String(input.businessName||''),
      cpuUsage:percent(input.cpuUsage),memoryUsage:percent(input.memoryUsage),storageUsage:percent(input.storageUsage),
      databaseSize:Number(input.databaseSize||0),workspaceHealth:String(input.workspaceHealth||'unknown'),
      apiHealth:String(input.apiHealth||'unknown'),edgeFunctionHealth:String(input.edgeFunctionHealth||'unknown'),
      realtimeHealth:String(input.realtimeHealth||'unknown'),storageHealth:String(input.storageHealth||'unknown'),
      connectionStatus:String(input.connectionStatus||'offline'),version:String(input.version||'unknown'),
      migrationVersion:String(input.migrationVersion||'unknown'),measuredAt:input.measuredAt||null
    });
  }
  function score(value){
    const health=['workspaceHealth','apiHealth','edgeFunctionHealth','realtimeHealth','storageHealth'].filter(k=>value[k]==='healthy').length;
    const resources=[value.cpuUsage,value.memoryUsage,value.storageUsage].filter(v=>v<85).length;
    return Math.round((health+resources)/8*100);
  }
  ns.HealthMonitor=Object.freeze({version:'1.0.0',METRICS,normalize,score});
})(typeof globalThis!=='undefined'?globalThis:window);
