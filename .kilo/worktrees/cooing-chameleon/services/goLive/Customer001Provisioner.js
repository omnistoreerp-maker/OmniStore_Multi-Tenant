(function(root){
  'use strict';const ns=root.OmniGoLive=root.OmniGoLive||{};
  const STEPS=Object.freeze(['validateSupabaseConnection','validateInstallerReadiness','createTenant','createWorkspace','createOwnerUser','applyRoles','applyPermissions','seedDefaultSettings','seedBusinessCategories','generateLicense','generateLoginUrl','verifyWorkspace','createRollbackPoint']);
  function preview(profile){profile=profile||ns.MarioFelyWorkspaceBuilder.profile;return Object.freeze({customerNumber:'001',tenantId:profile.tenantId,workspaceSlug:profile.workspaceSlug,steps:Object.freeze(STEPS.map((id,index)=>Object.freeze({order:index+1,id,status:'prepared',executed:false}))),requiresProductionMode:true,requiresOwner:true,requiresValidConnection:true,requiresValidation:true,requiresConfirmation:true,requiresRollbackPoint:true,customerCreated:false,workspaceCreated:false,userCreated:false,licenseGenerated:false,executed:false});}
  ns.Customer001Provisioner=Object.freeze({version:'1.0.0',STEPS,preview});
})(typeof globalThis!=='undefined'?globalThis:window);
