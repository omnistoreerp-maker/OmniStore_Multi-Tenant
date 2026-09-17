(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function build(operation,payload,requestId){const definition=ns.OperationRegistry.get(operation);return Object.freeze({requestId:String(requestId||''),operation,tenantId:String(payload&&payload.tenantId||''),payload:Object.freeze({...payload}),definition,stages:Object.freeze(['preview','validation','estimate','confirmation','execution','verification','audit','rollbackPoint']),createdAt:new Date().toISOString(),executed:false});}
  ns.ExecutionRequestBuilder=Object.freeze({version:'1.0.0',build});
})(typeof globalThis!=='undefined'?globalThis:window);
