(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};const TYPES=Object.freeze(['ai','knowledge','analysis','training']);
  function build(type,data){if(!TYPES.includes(type))return Object.freeze({valid:false,error:'UNSUPPORTED_AI_REPORT'});return Object.freeze({valid:true,type,generatedAt:new Date().toISOString(),summary:type==='knowledge'?`Knowledge articles: ${ns.KnowledgeCenter.articles.length}`:type==='training'?`Training topics: ${ns.TrainingAssistant.topics.length}`:'Advisory AI summary generated from the current read-only snapshot.',data:Object.freeze({...data}),official:false,readOnly:true});}
  ns.AIReportBuilder=Object.freeze({version:'1.0.0',TYPES,build});
})(typeof globalThis!=='undefined'?globalThis:window);
