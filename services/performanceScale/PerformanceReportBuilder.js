(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};const TYPES=Object.freeze(['performance','optimization','realtime','memory','database']);
  function build(type,data){if(!TYPES.includes(type))return Object.freeze({valid:false,error:'UNSUPPORTED_PERFORMANCE_REPORT'});return Object.freeze({valid:true,type,generatedAt:new Date().toISOString(),data:Object.freeze({...data}),readOnly:true});}
  ns.PerformanceReportBuilder=Object.freeze({version:'1.0.0',TYPES,build});
})(typeof globalThis!=='undefined'?globalThis:window);
