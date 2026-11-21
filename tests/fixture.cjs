/* Mock SDK/kernel fixture. Not a real SiYuan installation. No remote assets. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
function sampleSVG(n=0){
 const sizes=[[1200,850],[900,1000],[1600,900],[700,1200]];const[w,h]=sizes[n%sizes.length];
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1200 850"><rect width="1200" height="850" fill="${n%2?'#e8eee9':'#eaf0f5'}"/><rect x="52" y="54" width="1096" height="742" rx="8" fill="#fff"/><text x="90" y="115" fill="#273e42" font-family="sans-serif" font-size="30">Image fixture ${n+1}</text><text x="90" y="165" fill="#53696c" font-family="sans-serif" font-size="18">Screenshot layout and text legibility sample</text><path d="M90 215H1110M90 405H1110M90 595H1110" stroke="#d9e0e4"/><text x="90" y="285" fill="#273e42" font-family="sans-serif" font-size="22">REFERENCE</text><text x="90" y="355" fill="#356b70" font-family="sans-serif" font-size="46">${n+1} / ${sizes.length}</text><rect x="690" y="245" width="360" height="90" rx="5" fill="#b9cbd3"/><rect x="690" y="450" width="240" height="90" rx="5" fill="#b7c9b9"/><text x="90" y="665" fill="#273e42" font-family="sans-serif" font-size="20">This image contains no private workspace data.</text><text x="90" y="715" fill="#53696c" font-family="sans-serif" font-size="18">Different aspect ratios should retain their complete content.</text></svg>`;
}
function html(offline=false){
 const core=fs.readFileSync(path.join(root,'src/core.js'),'utf8'),entry=fs.readFileSync(path.join(root,'dist','index.js'),'utf8'),css=fs.readFileSync(path.join(root,'index.css'),'utf8'),hostCSS=fs.readFileSync(path.join(__dirname,'host-styles.css'),'utf8');
 return `<!doctype html><meta charset="utf-8"><title>Inline Gallery — Mock host</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;color:#283b38;background:#f8f8f5;font:15px/1.5 system-ui}main{max-width:1500px;margin:24px auto;padding:0 24px}header{margin-bottom:20px}header small{font-size:12px;color:#637572}h1{font-size:25px;font-weight:500;margin:12px 0}#host{padding:20px;background:#fff;border-radius:8px;outline:none}.fixture-note{font-size:12px;color:#637572}@media(prefers-color-scheme:dark){body{background:#17191b;color:#e6e8eb;--b3-theme-background:#222427;--b3-theme-on-background:#e6e8eb;--b3-theme-on-surface:#aeb5bc;--b3-theme-surface:#2d3035;--b3-border-color:#44494f;--b3-theme-primary:#9dbcf2;--b3-theme-primary-lightest:#35465e}#host{background:#222427}} ${hostCSS} ${css}</style><main><header><small>INLINE GALLERY · 0.2.0</small><h1>文档图片画廊</h1></header><div id="host" class="protyle-wysiwyg" contenteditable="true"><div class="custom-block" data-type="NodeCustomBlock" data-node-id="20261113000000-abcdefg"><div id="mount" class="custom-block__content"></div></div></div><p class="fixture-note">Mock SDK + API · This preview does not write to a real SiYuan workspace.</p></main><script>
window.siyuan={config:{readonly:false}};window.messages=[];window.store={};window.attrs={};window.calls=[];window.failNext=false;window.delayUpload=0;window.modernUpload=false;window.closed=false;window.epoch=0;window.commits=0;window.rejectWrites=false;window.samples=${JSON.stringify(Array.from({length:4},(_,i)=>'data:image/svg+xml,'+encodeURIComponent(sampleSVG(i))))};
const originalImageSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
${offline?`Object.defineProperty(HTMLImageElement.prototype,'src',{get:originalImageSrc.get,set(value){if(value.startsWith('/assets/'))value=samples[Number((value.match(/sample-(\\d+)/)||[])[1]||0)%samples.length];originalImageSrc.set.call(this,value);}});`:''}
const nativeFetch=fetch;
window.fetch=async function(url,options={}){
 if(!String(url).startsWith('/api/'))return nativeFetch(url,options);calls.push({url,body:options.body});
 if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
 let data=null;if(url==='/api/attr/getBlockAttrs')data=attrs;
 if(url==='/api/attr/setBlockAttrs')Object.assign(attrs,JSON.parse(options.body).attrs);
 if(url==='/api/asset/upload'){
  if(delayUpload)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,delayUpload);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
  if(failNext){failNext=false;return new Response(JSON.stringify({code:-1,msg:'simulated disk full'}));}
  const file=options.body.get('file[]'),name=file.name,src='assets/upload-'+calls.length+'.png';
  data=modernUpload?{succFiles:[{index:0,name,path:src}]}:{succMap:{[name]:src}};
 }
 return new Response(JSON.stringify({code:0,msg:'',data}),{headers:{'Content-Type':'application/json'}});
};
class Plugin{constructor(){this.name='siyuan-inline-gallery';this.customBlockRenders={};this.data={};}async loadData(k){return store[k];}async saveData(k,v){store[k]=structuredClone(v);}addBreadcrumbButton(v){window.insertButton=v;}addCommand(v){window.command=v;}}
window.C=(()=>{const module={exports:{}};new Function('module',${JSON.stringify(core)})(module);return module.exports;})();
const Gallery=(()=>{const module={exports:{}};new Function('module','require',${JSON.stringify(entry)})(module,name=>{if(name==='siyuan')return{Plugin,showMessage:(...args)=>messages.push(args)};throw new Error('Unexpected external module '+name);});return module.exports;})();
window.galleryQuery=selector=>document.querySelector('#mount > .sig-gallery-host')?.shadowRoot.querySelector(selector);
window.plugin=new Gallery();window.cleanup=null;window.model={...C.DEFAULTS,images:[]};window.raw='';
window.render=(next=model)=>{
 if(cleanup)cleanup();const mine=++epoch;closed=false;raw=typeof next==='string'?next:JSON.stringify(next);try{model=JSON.parse(raw);}catch{}
 const mount=document.querySelector('#mount');mount.replaceChildren();let pending=raw,queued=false;
 cleanup=plugin.customBlockRenders.gallery.render({element:mount,content:raw,setContent:value=>{
  if(rejectWrites||siyuan.config.readonly||closed||mine!==epoch)return false;pending=value;if(queued)return true;queued=true;
  queueMicrotask(()=>{queued=false;if(closed||mine!==epoch||pending===raw)return;commits++;render(pending);});return true;
 }});
};
window.makeFile=async(name='same.png')=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=850;const ctx=canvas.getContext('2d');ctx.fillStyle='#e8eee9';ctx.fillRect(0,0,1200,850);ctx.fillStyle='#274e4a';ctx.font='30px sans-serif';ctx.fillText('Clipboard image fixture',50,80);return new File([await new Promise(r=>canvas.toBlob(r))],name,{type:'image/png'});};
window.seed=(n=2,layout='row')=>render({...C.DEFAULTS,layout,images:Array.from({length:n},(_,i)=>({id:'sample'+i,src:'assets/sample-'+i+'.svg',name:'fixture-'+i+'.svg',alt:'',width:[1200,900,1600,700][i%4],height:[850,1000,900,1200][i%4]}))});
window.initialized=plugin.onload().then(()=>seed(${offline?'2':'0'}));
</script>`;
}
function serve(){return http.createServer((req,res)=>{if(req.url.startsWith('/assets/')){const n=Number((req.url.match(/sample-(\d+)/)||[])[1]||0);res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(sampleSVG(n));}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html());}});}
module.exports={root,html,serve};
if(require.main===module){if(process.env.WRITE_PREVIEW){fs.writeFileSync(path.join(__dirname,'preview.html'),html(true));console.log('Updated tests/preview.html');}else{const server=serve();server.listen(0,'127.0.0.1',()=>console.log('Mock preview: http://127.0.0.1:'+server.address().port));}}
