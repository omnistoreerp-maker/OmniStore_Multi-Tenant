(function(root){
  'use strict';const ns=root.OmniGoLive=root.OmniGoLive||{};
  function create(options){options=options||{};const productionMode=ns.ProductionModeManager.create(),connection=ns.SupabaseConnectionManager.create({transport:options.connectionTransport});let connectionResult=null,lastValidation=null,packages=[];const profile=ns.MarioFelyWorkspaceBuilder.profile;
    function snapshot(){const mode=productionMode.snapshot(),readiness=lastValidation||ns.GoLiveValidator.readiness({profile,productionMode:mode,connection:connectionResult,installerReady:false,rollbackReady:false});return Object.freeze({profile,workspace:ns.MarioFelyWorkspaceBuilder.build(),productionMode:mode,connection:connection.status(),readiness,installer:ns.ProductionInstaller.preview({}),provisioning:ns.Customer001Provisioner.preview(profile),packages:Object.freeze([...packages]),dangerousActionsEnabled:readiness.dangerousActionsEnabled,readOnly:true});}
    async function testConnection(input){connectionResult=await connection.test(input);return connectionResult;}
    function applyProductionStatus(value){productionMode.applyStatus(value);return snapshot();}
    function validate(input){lastValidation=ns.GoLiveValidator.readiness({profile,productionMode:productionMode.snapshot(),connection:connectionResult,installerReady:Boolean(input&&input.installerReady),rollbackReady:Boolean(input&&input.rollbackReady)});return lastValidation;}
    function installerPreview(){return ns.ProductionInstaller.preview({projectRef:connection.status().config&&connection.status().config.projectRef});}
    function provisioningPreview(){return ns.Customer001Provisioner.preview(profile);}
    function generatePackage(){const value=Object.freeze({id:'customer-001-mario-fely',generatedAt:new Date().toISOString(),profile,workspace:ns.MarioFelyWorkspaceBuilder.build(),installer:installerPreview(),provisioning:provisioningPreview(),productionModeRequired:true,executed:false});packages=[value,...packages];return value;}
    function releaseSnapshot(){return Object.freeze({release:'OmniStore ERP v1.0 Commercial Release',customerNumber:'001',buildDate:'2026-07-02',productionModeDefault:'OFF',previousRegressionBaseline:1851,phase36Checks:129,totalChecks:1980,executionPerformed:false});}
    return Object.freeze({snapshot,testConnection,applyProductionStatus,validate,installerPreview,provisioningPreview,generatePackage,releaseSnapshot,report:type=>ns.GoLiveReportBuilder.build(type,snapshot()),enableProductionPreview:ownerId=>productionMode.enablePreview(ownerId)});
  }
  ns.GoLiveEngine=Object.freeze({version:'1.0.0',create});
})(typeof globalThis!=='undefined'?globalThis:window);
