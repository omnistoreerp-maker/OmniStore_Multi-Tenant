(function(root){
  'use strict';const ns=root.OmniGoLive=root.OmniGoLive||{};const TYPES=Object.freeze(['goLive','production','marioFelyRollout','releaseV1','rollback']);
  function build(type,data){if(!TYPES.includes(type))return Object.freeze({valid:false,error:'UNSUPPORTED_GO_LIVE_REPORT'});return Object.freeze({valid:true,type,generatedAt:new Date().toISOString(),release:'OmniStore ERP v1.0',customer:'Mario Fely #001',data:Object.freeze({...data}),executionPerformed:false,readOnly:true});}
  ns.GoLiveReportBuilder=Object.freeze({version:'1.0.0',TYPES,build});
})(typeof globalThis!=='undefined'?globalThis:window);
