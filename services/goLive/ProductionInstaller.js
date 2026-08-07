(function(root){
  'use strict';const ns=root.OmniGoLive=root.OmniGoLive||{};
  const STEPS=Object.freeze(['validateConnection','validateInstallerReadiness','previewSchema','previewTables','previewIndexes','previewRLS','previewDefaultData','createRollbackPoint','awaitControlledExecution']);
  function preview(input){input=input||{};return Object.freeze({operation:'databaseInstallation',projectRef:input.projectRef||'',steps:Object.freeze(STEPS.map((id,index)=>Object.freeze({order:index+1,id,status:'prepared',executed:false}))),requiresProductionMode:true,requiresOwner:true,requiresConfirmation:true,requiresRollbackPoint:true,executed:false,sqlExecuted:0,supabaseWrites:0});}
  ns.ProductionInstaller=Object.freeze({version:'1.0.0',STEPS,preview});
})(typeof globalThis!=='undefined'?globalThis:window);
