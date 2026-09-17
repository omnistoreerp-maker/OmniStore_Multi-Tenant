(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function validate(operation,payload,context){const errors=[];const definition=ns.OperationRegistry.get(operation);if(!definition)errors.push('UNSUPPORTED_OPERATION');if(definition&&definition.requiresTenant&&!String(payload&&payload.tenantId||'').trim())errors.push('TENANT_ID_REQUIRED');if(!context||!context.mode||!context.mode.enabled)errors.push('PRODUCTION_MODE_DISABLED');if(!context||!context.mode||!context.mode.serverEnabled)errors.push('SERVER_EXECUTION_DISABLED');const owner=ns.OwnerAuthorizationGuard.validate(context&&context.session);errors.push(...owner.errors);return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors),definition,owner});}
  ns.ExecutionPolicyValidator=Object.freeze({version:'1.0.0',validate});
})(typeof globalThis!=='undefined'?globalThis:window);
