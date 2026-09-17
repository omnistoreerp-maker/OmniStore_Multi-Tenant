const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..','..');let tests=0;const ok=(v,m)=>{assert.ok(v,m);tests+=1;};const eq=(a,b,m)=>{assert.strictEqual(a,b,m);tests+=1;};
const box=vm.createContext({console,Date,globalThis:{}});box.window=box.globalThis;
['HealthMonitor.js','BackupCenter.js','UpdateCenter.js','ErrorCenter.js','NotificationCenter.js','PlatformDashboard.js','PlatformOperationsValidator.js','PlatformOperationsEngine.js'].forEach(f=>new vm.Script(fs.readFileSync(path.join(__dirname,f),'utf8')).runInContext(box));
async function run(){const ns=box.globalThis.OmniPlatformOperations;
  ['HealthMonitor.js','BackupCenter.js','UpdateCenter.js','ErrorCenter.js','NotificationCenter.js','PlatformDashboard.js','PlatformOperationsValidator.js','PlatformOperationsEngine.js','platformOperationsUi.js','platformOperations.test.js','README.md'].forEach(f=>ok(fs.existsSync(path.join(__dirname,f)),`Missing ${f}`));
  eq(ns.HealthMonitor.METRICS.length,10);const health=ns.HealthMonitor.normalize({tenantId:'t1',businessName:'Demo',cpuUsage:20,memoryUsage:30,storageUsage:40,databaseSize:100,workspaceHealth:'healthy',apiHealth:'healthy',edgeFunctionHealth:'healthy',realtimeHealth:'healthy',storageHealth:'healthy',connectionStatus:'online',version:'1.0.0',migrationVersion:'29'});
  eq(ns.HealthMonitor.score(health),100);eq(ns.UpdateCenter.compare('1.0.0','1.1.0'),-1);eq(ns.UpdateCenter.preview({currentVersion:'1.0.0',availableVersion:'1.1.0'}).executed,false);
  eq(ns.BackupCenter.preview('manual',{tenantId:'t1'}).executed,false);eq(ns.BackupCenter.preview('restore',{tenantId:'t1'}).writes,0);eq(ns.BackupCenter.verify({id:'s1',checksum:'x',status:'verified'}).valid,true);
  eq(ns.ErrorCenter.CATEGORIES.length,7);eq(ns.NotificationCenter.TYPES.length,7);
  const provider={readSnapshot:async()=>({customers:[{id:'t1',status:'active',licenseStatus:'active'}],health:[health],errors:[{id:'e1',tenantId:'t1',category:'browser',message:'x'}],updates:[{tenantId:'t1',currentVersion:'1.0.0',availableVersion:'1.1.0'}],snapshots:[]})};
  const engine=ns.PlatformOperationsEngine.create({provider});const state=await engine.refresh();eq(state.readOnly,true);eq(state.dashboard.totalCustomers,1);eq(state.dashboard.onlineWorkspaces,1);eq(state.dashboard.databaseHealth,100);eq(state.notifications.sent,0);eq(engine.backupPreview('manual',{tenantId:'t1'}).previewOnly,true);eq(engine.updatePreview({currentVersion:'1',availableVersion:'2'}).executed,false);
  const source=fs.readdirSync(__dirname).filter(f=>f.endsWith('.js')&&!f.endsWith('.test.js')).map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n');
  eq(/localStorage\s*\.|service_role|SUPABASE_DB_URL|postAccounting\s*\(|postInventory\s*\(/i.test(source),false);eq(/fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/i.test(source),false);
  const html=fs.readFileSync(path.join(root,'DigiTronics_v5.html'),'utf8');['platform-dashboard','monitoring-center','backup-center','update-center','error-dashboard','customer-health'].forEach(p=>{ok(html.includes(`data-page="${p}"`));ok(html.includes(`id="page-${p}"`));ok(html.includes(`renderPlatformOperationsPage('${p}')`));});
  return{tests,platformOperationsReadiness:100,realBackups:0,realUpdates:0,connections:0};
}
if(require.main===module)run().then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
