(function(root){
  'use strict';const ns=root.OmniPerformanceScale=root.OmniPerformanceScale||{};
  function analyze(assets){const values=(assets||[]).map(x=>Object.freeze({name:String(x.name||''),type:x.type||'other',bytes:Math.max(0,Number(x.bytes||0)),lazyCandidate:Boolean(x.lazyCandidate),compressedBytes:Math.max(0,Number(x.compressedBytes||0))}));const total=values.reduce((s,x)=>s+x.bytes,0),compressed=values.reduce((s,x)=>s+x.compressedBytes,0);return Object.freeze({assets:Object.freeze(values),totalBytes:total,compressedBytes:compressed,savingsBytes:Math.max(0,total-compressed),lazyCandidates:values.filter(x=>x.lazyCandidate).length,recommendations:Object.freeze(['split optional modules','lazy-load images','compress text assets','preload critical shell']),filesChanged:0});}
  ns.BundleAssetAnalyzer=Object.freeze({version:'1.0.0',analyze});
})(typeof globalThis!=='undefined'?globalThis:window);
