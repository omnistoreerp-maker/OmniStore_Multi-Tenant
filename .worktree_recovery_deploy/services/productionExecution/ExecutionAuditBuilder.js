(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function build(input){input=input||{};return Object.freeze({executionId:input.executionId||null,who:input.who||null,when:input.when||new Date().toISOString(),customer:input.customer||null,durationMs:Number(input.durationMs||0),result:input.result||'unknown',errors:Object.freeze(input.errors||[]),rollbackId:input.rollbackId||null,serverPersisted:Boolean(input.serverPersisted)});}
  ns.ExecutionAuditBuilder=Object.freeze({version:'1.0.0',build});
})(typeof globalThis!=='undefined'?globalThis:window);
