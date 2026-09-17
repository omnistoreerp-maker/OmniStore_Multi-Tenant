(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function analyze(value){value=value||{};const partial=Array.isArray(value.steps)&&value.steps.some(x=>x.status==='completed')&&value.steps.some(x=>x.status==='failed');return Object.freeze({transactionSafe:Boolean(value.transactionSafe),partialFailure:partial,retrySupported:Boolean(value.retrySupported),rollbackSupported:Boolean(value.rollbackId),verificationRequired:true,recommendation:partial&&value.rollbackId?'rollback':value.retrySupported?'retry':'manual-review'});}
  ns.FailureRecoveryEngine=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
