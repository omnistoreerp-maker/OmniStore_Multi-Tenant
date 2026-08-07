(function(root){
  'use strict';const ns=root.OmniAICopilot=root.OmniAICopilot||{};const topics=Object.freeze(['navigation','products','sales','purchases','inventory','reports','preview-centers','security']);
  function lesson(topic){if(!topics.includes(topic))return Object.freeze({valid:false,error:'UNKNOWN_TRAINING_TOPIC'});return Object.freeze({valid:true,topic,steps:Object.freeze([`Open ${topic}`,`Review the ${topic} screen`,`Use preview or sample data`, 'Record questions without changing live data']),actionsExecuted:0});}
  ns.TrainingAssistant=Object.freeze({version:'1.0.0',topics,lesson});
})(typeof globalThis!=='undefined'?globalThis:window);
