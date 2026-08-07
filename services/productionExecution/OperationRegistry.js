(function(root){
  'use strict';const ns=root.OmniProductionExecution=root.OmniProductionExecution||{};
  const definitions=Object.freeze([
    {id:'databaseInstallation',label:'Database Installation',requiresTenant:false,rollback:true},
    {id:'customerProvisioning',label:'Customer Provisioning',requiresTenant:false,rollback:true},
    {id:'workspaceActivation',label:'Workspace Activation',requiresTenant:true,rollback:true},
    {id:'backup',label:'Backup',requiresTenant:true,rollback:false},
    {id:'restore',label:'Restore',requiresTenant:true,rollback:true},
    {id:'deployment',label:'Deployment',requiresTenant:false,rollback:true},
    {id:'licenseActivation',label:'License Activation',requiresTenant:true,rollback:true},
    {id:'supabaseSchemaInstallation',label:'Supabase Schema Installation',requiresTenant:false,rollback:true},
    {id:'edgeFunctionDeployment',label:'Edge Function Deployment',requiresTenant:false,rollback:true},
    {id:'storageBucketCreation',label:'Storage Bucket Creation',requiresTenant:false,rollback:true}
  ].map(x=>Object.freeze(x)));
  ns.OperationRegistry=Object.freeze({version:'1.0.0',definitions,get:id=>definitions.find(x=>x.id===id)||null});
})(typeof globalThis!=='undefined'?globalThis:window);
