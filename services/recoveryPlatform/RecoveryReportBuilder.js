(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};const TYPES=Object.freeze(['recovery','backup','restore','update','version']);
  function build(type,data){if(!TYPES.includes(type))return Object.freeze({valid:false,error:'UNSUPPORTED_RECOVERY_REPORT'});return Object.freeze({valid:true,type,generatedAt:new Date().toISOString(),data:Object.freeze({...data}),readOnly:true});}
  ns.RecoveryReportBuilder=Object.freeze({version:'1.0.0',TYPES,build});
})(typeof globalThis!=='undefined'?globalThis:window);
