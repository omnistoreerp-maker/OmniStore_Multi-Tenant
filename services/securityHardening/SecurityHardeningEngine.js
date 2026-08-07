(function(root){
  'use strict';const ns=root.OmniSecurityHardening=root.OmniSecurityHardening||{};
  function create(){const audit=ns.CentralAuditEngine.create();let report=null;function scan(input){input=input||{};report=ns.SecurityReportBuilder.build({authorization:ns.AuthorizationSecurityValidator.validate(input.authorization),tenant:ns.TenantSecurityValidator.validate(input.tenant),database:ns.DatabaseSecurityReviewer.review(input.database),inputs:ns.InputSecurityValidator.validate(input.inputs),secrets:ns.SecretScanner.scan(input.files),production:ns.ProductionReadinessChecker.check(input.production)});return report;}return Object.freeze({scan,report:()=>report,audit,controls:()=>ns.SecurityPolicyRegistry.controls});}
  ns.SecurityHardeningEngine=Object.freeze({version:'1.0.0',create});
})(typeof globalThis!=='undefined'?globalThis:window);
