(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const REPORTS=Object.freeze(['platform','customer','automation','monitoring','health','jobs','notifications']);
  function build(type,state){if(!REPORTS.includes(type))return Object.freeze({valid:false,error:'UNSUPPORTED_REPORT'});return Object.freeze({valid:true,type,generatedAt:new Date().toISOString(),data:Object.freeze({...state}),readOnly:true});}
  ns.PlatformReportBuilder=Object.freeze({version:'1.0.0',REPORTS,build});
})(typeof globalThis!=='undefined'?globalThis:window);
