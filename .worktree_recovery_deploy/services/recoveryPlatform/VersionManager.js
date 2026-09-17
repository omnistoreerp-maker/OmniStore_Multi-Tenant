(function(root){
  'use strict';const ns=root.OmniRecoveryPlatform=root.OmniRecoveryPlatform||{};
  function normalize(input){input=input||{};const builds=Object.freeze((input.installedBuilds||[]).map(x=>Object.freeze({...x})));return Object.freeze({currentVersion:input.currentVersion||'unknown',previousVersions:Object.freeze(input.previousVersions||[]),installedBuilds:builds,rollbackTargets:Object.freeze(builds.filter(x=>x.rollbackEligible).map(x=>x.version)),upgradeHistory:Object.freeze(input.upgradeHistory||[]),writes:0});}
  ns.VersionManager=Object.freeze({version:'1.0.0',normalize});
})(typeof globalThis!=='undefined'?globalThis:window);
