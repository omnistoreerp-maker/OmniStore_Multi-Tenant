(function(root){
  'use strict';const ns=root.OmniPlatformAutomation=root.OmniPlatformAutomation||{};
  const STEPS=Object.freeze(['createAuthUser','createWorkspace','runDatabaseInstallation','applyRLS','seedDefaultData','createAdminUser','generateLoginUrl','sendWelcomeEmail','generateLicense']);
  function prepare(input){input=input||{};const missing=['businessName','ownerName','email','businessType'].filter(k=>!String(input[k]||'').trim());return Object.freeze({valid:missing.length===0,missing:Object.freeze(missing),workflowId:'zero-touch-preview',steps:Object.freeze(STEPS.map((id,index)=>Object.freeze({order:index+1,id,status:'prepared',executed:false}))),executionEnabled:false,authUsersCreated:0,workspacesCreated:0,sqlExecuted:0,emailsSent:0,licensesGenerated:0});}
  ns.ZeroTouchOnboardingWorkflow=Object.freeze({version:'1.0.0',STEPS,prepare});
})(typeof globalThis!=='undefined'?globalThis:window);
