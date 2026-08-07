(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  function build(definitions){return Object.freeze((definitions||[]).map((item,index)=>Object.freeze({jobId:`preview-job-${index+1}`,automationId:item.id,schedule:item.schedule,status:'planned',nextRun:null,executed:false,persisted:false})));}
  ns.AutomationSchedulerPreview=Object.freeze({version:'1.0.0',build});
})(typeof globalThis!=='undefined'?globalThis:window);
