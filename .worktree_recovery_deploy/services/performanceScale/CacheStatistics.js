(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function calculate(input){input=input||{};const hits=Math.max(0,Number(input.hits||0)),misses=Math.max(0,Number(input.misses||0)),entries=Math.max(0,Number(input.entries||0)),bytes=Math.max(0,Number(input.bytes||0)),total=hits+misses;return Object.freeze({hits,misses,hitRate:total?Math.round(hits/total*10000)/100:0,entries,bytes,averageEntryBytes:entries?Math.round(bytes/entries):0,evictionPolicy:input.evictionPolicy||'LRU-preview',cacheMutated:false});}
  ns.CacheStatistics=Object.freeze({version:'1.0.0',calculate});
})(typeof globalThis!=='undefined'?globalThis:window);
