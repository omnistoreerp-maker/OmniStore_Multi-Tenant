(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  function phrase(request){return `EXECUTE:${request.operation}:${request.tenantId||'platform'}:${request.requestId}`;}function validate(request,value){const expected=phrase(request);return Object.freeze({valid:String(value||'')===expected,expected,provided:Boolean(value)});}
  ns.ConfirmationManager=Object.freeze({version:'1.0.0',phrase,validate});
})(typeof globalThis!=='undefined'?globalThis:window);
