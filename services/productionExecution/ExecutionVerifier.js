(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function validate(value){value=value||{};const checks=Object.freeze({executionId:Boolean(value.executionId),resultPresent:Boolean(value.result),verificationPassed:value.verification&&value.verification.passed===true,auditRecorded:Boolean(value.auditId),rollbackPoint:Boolean(value.rollbackId)||value.rollbackSupported===false});const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);return Object.freeze({valid:failed.length===0,checks,failed:Object.freeze(failed)});}
  ns.ExecutionVerifier=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
