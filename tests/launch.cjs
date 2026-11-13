const path=require('node:path'),{pathToFileURL}=require('node:url');
module.exports=async()=>{
 let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'));}
 if(process.env.CHROMIUM_PATH)return chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 let serverless;
 try{serverless=require.resolve('@sparticuz/chromium',{paths:[__dirname,path.resolve(__dirname,'../../qa')]});}catch{}
 if(serverless){const{default:binary}=await import(pathToFileURL(serverless).href);return chromium.launch({executablePath:await binary.executablePath(),headless:true,args:binary.args});}
 return chromium.launch({headless:true});
};
