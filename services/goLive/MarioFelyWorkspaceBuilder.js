(function(root){
  'use strict';const ns=root.OmniGoLive=root.OmniGoLive||{};
  const profile=Object.freeze({customerNumber:'001',customerName:'Mario Fely',businessName:'Mario Fely Auto Accessories',businessNameAr:'ماريو فيلي لإكسسوارات السيارات',phone:'01273635036',email:'Mariohani203@gmail.com',addressAr:'شارع يلبغة متفرع من شبرا مصر الرئيسي',activity:'Car accessories, stickers, fiberglass, spare parts, car cleaning products.',businessType:'car_accessories',tenantId:'mario_fely',workspaceSlug:'mario-fely-auto-accessories',categories:Object.freeze(['إكسسوارات سيارات','استيكر','فيبر','قطع غيار','منظفات سيارات'])});
  function build(){return Object.freeze({...profile,workspace:Object.freeze({slug:profile.workspaceSlug,status:'prepared',databaseInstalled:false,ownerCreated:false,licenseGenerated:false,loginUrlGenerated:false,rollbackPointCreated:false}),writes:0});}
  ns.MarioFelyWorkspaceBuilder=Object.freeze({version:'1.0.0',profile,build});
})(typeof globalThis!=='undefined'?globalThis:window);
