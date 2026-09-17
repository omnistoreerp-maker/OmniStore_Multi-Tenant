(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function analyze(input){input=input||{};return Object.freeze({health:input.health||'unknown',connected:Boolean(input.connected),latencyMs:Math.max(0,Number(input.latencyMs||0)),reconnectStrategy:Object.freeze({mode:'exponential-backoff',maxAttempts:8,jitter:true,executed:false}),offlineQueue:Object.freeze({pending:Math.max(0,Number(input.offlinePending||0)),writesPerformed:0}),syncLatencyMs:Math.max(0,Number(input.syncLatencyMs||0)),connectionsOpened:0,readOnly:true});}
  ns.RealtimePerformanceMonitor=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
