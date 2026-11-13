'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=require('./fixture.cjs');
let PNG;try{({PNG}=require('pngjs'));}catch{({PNG}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/pngjs'));}
(async()=>{
 const server=fixture.serve();await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const browser=await require('./launch.cjs')();const report=[];const page=await browser.newPage({viewport:{width:1100,height:1000}});
 const run=async(name,fn)=>{
  const errors=[],onError=e=>errors.push(e.message);page.on('pageerror',onError);await page.setViewportSize({width:1100,height:1000});await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});
  try{await page.goto(url);await page.evaluate(()=>initialized);await fn(page);assert.deepEqual(errors,[]);report.push(name);console.log('PASS '+name);}finally{page.off('pageerror',onError);}
 };
 const settle=p=>p.waitForTimeout(120),seed=async(p,n=2)=>{await p.evaluate(n=>seed(n),n);await settle(p);};
 const finish=p=>p.waitForFunction(()=>plugin.jobs.size===0);
 try{
 await run('empty gallery and icon-only accessible toolbar',async p=>{
  assert.ok(await p.locator('.sig-empty').isVisible());assert.ok(await p.locator('.sig-empty').evaluate(e=>e.clientHeight>=180));
  assert.equal(await p.locator('.sig-toolbar').textContent(),'');
  for(const name of ['横排','主图','添加图片','编辑']){const button=p.locator('.sig-toolbar').getByRole('button',{name,exact:true});assert.ok(await button.isVisible());assert.equal(await button.textContent(),'');assert.ok(await button.locator('svg').count());}
  assert.ok(await p.locator('.sig-status').isHidden());assert.equal(await p.getByText('左右滑动浏览',{exact:false}).count(),0);
 });
 await run('host SVG/image/button theme rules cannot penetrate the gallery ShadowRoot',async p=>{
  await seed(p);
  await p.addStyleTag({content:'svg{fill:rgb(255,0,0)!important;stroke:none!important;width:96px!important}.protyle-wysiwyg button img{object-fit:cover!important;transform:scale(1.8)!important}.protyle-wysiwyg button{padding:60px!important}'});
  const values=await p.getByRole('button',{name:'横排',exact:true}).locator('svg').evaluate(e=>({fill:getComputedStyle(e).fill,stroke:getComputedStyle(e).stroke,width:e.getBoundingClientRect().width,shadow:e.getRootNode() instanceof ShadowRoot}));
  assert.equal(values.shadow,true);assert.equal(values.fill,'none');assert.notEqual(values.stroke,'none');assert.equal(values.width,16);
  const photo=await p.locator('.sig-photo img').first().evaluate(e=>({fit:getComputedStyle(e).objectFit,transform:getComputedStyle(e).transform}));assert.equal(photo.fit,'contain');assert.equal(photo.transform,'none');
  await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');assert.equal(await p.getByRole('button',{name:'主图',exact:true}).getAttribute('aria-pressed'),'true');
 });
 await run('wide and tall images retain all four colored corners in row and main-image modes',async p=>{
  const colors=[[220,30,30],[30,160,60],[30,80,220],[230,180,20]];
  for(const [kind,width,height]of [['wide',3200,900],['tall',900,3200]]){
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><rect width="100%" height="100%" fill="white"/>'+[[0,0],[width-160,0],[0,height-160],[width-160,height-160]].map(([x,y],i)=>'<rect x="'+x+'" y="'+y+'" width="160" height="160" fill="rgb('+colors[i].join(',')+')"/>').join('')+'</svg>';
   await p.route('**/assets/corners-'+kind+'.svg',r=>r.fulfill({contentType:'image/svg+xml',body:svg}));
   for(const layout of ['row','focus']){
    await p.evaluate(({kind,width,height,layout})=>render({...C.DEFAULTS,layout,images:[{id:'corners',src:'assets/corners-'+kind+'.svg',width,height,alt:''}]}),{kind,width,height,layout});
    const photo=p.locator('.sig-photo');await photo.locator('img').evaluate(e=>e.decode());await settle(p);
    const box=await photo.evaluate(e=>{const p=e.getBoundingClientRect(),i=e.querySelector('img').getBoundingClientRect();return{x:i.x-p.x,y:i.y-p.y,w:i.width,h:i.height,frame:e.clientWidth,viewport:e.closest('.sig-stage').clientWidth};});
    if(layout==='row')assert.ok(box.frame<=box.viewport*.88+1,'single wide screenshot exceeds its viewport');
    const paintedW=Math.min(box.w,box.h*width/height),paintedH=Math.min(box.h,box.w*height/width),left=box.x+(box.w-paintedW)/2,top=box.y+(box.h-paintedH)/2;
    const png=PNG.sync.read(await photo.screenshot());
    for(const [i,[x,y]]of [[20,20],[width-20,20],[20,height-20],[width-20,height-20]].entries()){
     const px=Math.min(png.width-1,Math.max(0,Math.round(left+x/width*paintedW))),py=Math.min(png.height-1,Math.max(0,Math.round(top+y/height*paintedH))),offset=(py*png.width+px)*4;
     assert.ok(colors[i].every((v,c)=>Math.abs(png.data[offset+c]-v)<=4),kind+' '+layout+' corner '+i+' was cropped or distorted');
    }
   }
  }
 });
 await run('slash is the sole insertion entry; no breadcrumb or command-palette entry is registered',async p=>{
  const result=await p.evaluate(()=>{
   const calls=[],publicEditor={protyle:{lute:{Md2BlockDOM:s=>'DOM:'+s},disabled:false},insert:(...args)=>calls.push(args)};
   const slash=plugin.protyleSlash[0];slash.callback(publicEditor);
   publicEditor.protyle.disabled=true;slash.callback(publicEditor);
   return {calls,filters:slash.filter,lite:slash.showInLite,breadcrumb:typeof window.insertButton,command:typeof window.command};
  });
  assert.equal(result.calls.length,1);assert.equal(result.breadcrumb,'undefined');assert.equal(result.command,'undefined');assert.ok(result.filters.includes('gallery')&&result.filters.includes('画廊')&&result.lite);
  for(const [body,dom]of result.calls){assert.equal(dom,true);assert.match(body,/DOM:;;;siyuan-inline-gallery\/gallery/);assert.match(body,/"version": 2/);assert.match(body,/"layout": "row"/);}
 });
 await run('large single-row scrolling at wide and narrow widths, without wrapping',async p=>{
  await seed(p);for(const width of [1500,1100,375]){
   await p.setViewportSize({width,height:1000});await settle(p);
   assert.equal(await p.locator('.sig-stage').getAttribute('data-layout'),'row');
   const boxes=await p.locator('.sig-stage>.sig-card').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{y:r.y,w:r.width,h:r.height};}));assert.equal(boxes.length,2);assert.ok(Math.abs(boxes[0].y-boxes[1].y)<1);
   assert.ok(await p.locator('.sig-stage').evaluate(e=>e.scrollWidth>e.clientWidth));
   assert.ok(await p.locator('.sig-gallery').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   if(width>1000)assert.ok(await p.locator('.sig-photo').first().evaluate(e=>e.clientHeight>420));
  }
 });
 await run('equal inline modes persist and preserve independent row/selection state through host disposal',async p=>{
  await seed(p,3);await p.getByRole('button',{name:'下一张',exact:true}).click();await p.waitForTimeout(400);let scroll=await p.locator('.sig-stage').evaluate(e=>e.scrollLeft);assert.ok(scroll>0);
  await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await settle(p);
  scroll=await p.evaluate(()=>plugin.ui.get('20261113000000-abcdefg').scroll);assert.ok(scroll>0);
  assert.equal(await p.locator('dialog').count(),0);assert.equal(await p.locator('.sig-main').count(),1);
  await p.getByRole('button',{name:'选择第 3 张图片',exact:true}).click();assert.equal(await p.getByRole('button',{name:'选择第 3 张图片',exact:true}).getAttribute('aria-pressed'),'true');
  await p.getByRole('button',{name:'横排',exact:true}).click();await p.waitForFunction(()=>model.layout==='row');await settle(p);assert.ok(Math.abs(await p.locator('.sig-stage').evaluate(e=>e.scrollLeft)-scroll)<2,JSON.stringify(await p.evaluate(()=>({saved:plugin.ui.get('20261113000000-abcdefg').scroll,actual:galleryQuery('.sig-stage').scrollLeft,mode:model.layout}))));
  await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await settle(p);assert.equal(await p.getByRole('button',{name:'选择第 3 张图片',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await p.getByRole('button',{name:'返回',exact:true}).count(),0);
 });
 await run('thumbnail strip centers when short and keeps a selected item visible when overflowing',async p=>{
  await seed(p);await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await settle(p);
  assert.ok(await p.locator('.sig-thumbs').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return Math.abs((a.left+a.right)/2-(b.left+b.right)/2)<1;}));
  await p.evaluate(()=>seed(20));await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await p.setViewportSize({width:375,height:1000});await settle(p);
  await p.locator('.sig-thumbs').evaluate(e=>e.scrollLeft=e.scrollWidth);await p.getByRole('button',{name:'选择第 20 张图片',exact:true}).click();await settle(p);
  assert.ok(await p.locator('.sig-thumbs').evaluate(e=>{const a=e.querySelector('[aria-pressed=true]').getBoundingClientRect(),b=e.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1;}));
 });
 await run('image zoom is separate from mode; actual pixels, fit and keyboard navigation work',async p=>{
  await seed(p);await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');
  await p.locator('.sig-photo').click();const dialog=p.getByRole('dialog',{name:'图片预览'});await dialog.locator('img').waitFor();await p.waitForFunction(()=>galleryQuery('dialog img').naturalWidth===1200);
  await dialog.getByRole('button',{name:'100%',exact:true}).click();assert.equal(await dialog.locator('img').evaluate(e=>e.clientWidth),1200);
  await dialog.getByRole('button',{name:'放大',exact:true}).click();assert.equal(await dialog.locator('img').evaluate(e=>e.clientWidth),1500);
  await dialog.getByRole('button',{name:'适应窗口',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'适应窗口',exact:true}).getAttribute('aria-pressed'),'true');
  await p.keyboard.press('ArrowRight');assert.equal(await dialog.locator('.sig-counter').textContent(),'2 / 2');await p.keyboard.press('Escape');await p.waitForSelector('dialog',{state:'detached'});assert.equal(await p.locator('dialog').count(),0);assert.equal(await p.locator('.sig-stage').getAttribute('data-layout'),'focus');
 });
 await run('captions are inert text; reorder/remove preserve the selected image and never delete files',async p=>{
  await seed(p,3);await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await p.getByRole('button',{name:'选择第 2 张图片',exact:true}).click();
  await p.getByRole('button',{name:'编辑',exact:true}).click();const caption=p.getByRole('textbox',{name:'第 2 张图片说明'});await caption.fill('<img onerror=alert(1)>');await caption.press('Tab');await p.waitForFunction(()=>model.images[1].alt.startsWith('<img'));
  assert.equal(await p.locator('[onerror]').count(),0);await p.getByRole('button',{name:'向前移动',exact:true}).nth(1).click();await p.waitForFunction(()=>model.images[0].id==='sample1');await settle(p);assert.equal(await p.locator('.sig-main .sig-card').getAttribute('data-image-id'),'sample1');
  await p.getByRole('button',{name:'从画廊移除，保留资源文件',exact:true}).last().click();await p.waitForFunction(()=>model.images.length===2);assert.ok(await p.evaluate(()=>!calls.some(x=>x.url.includes('removeFile'))));
 });
 await run('batch paste accepts duplicate filenames with legacy succMap and native asset protection',async p=>{
  await p.evaluate(async()=>{const dt=new DataTransfer();dt.items.add(await makeFile());dt.items.add(await makeFile());galleryQuery('.sig-gallery').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await p.waitForFunction(()=>model.images.length===2);await finish(p);assert.equal(await p.evaluate(()=>new Set(model.images.map(x=>x.src)).size),2);assert.equal(await p.evaluate(()=>model.images[0].name),'same.png');assert.equal(await p.evaluate(()=>model.images[0].alt),'');assert.equal(await p.evaluate(()=>Object.keys(plugin.pending).length),0);
  assert.ok(await p.evaluate(()=>model.images.every(x=>Object.entries(attrs).some(([k,v])=>k.startsWith('custom-data-assets-gallery-')&&v===x.src))));
 });
 await run('file picker and drop accept modern succFiles; ordinary editor paste is untouched',async p=>{
  await p.evaluate(()=>modernUpload=true);const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#ddd"/></svg>');
  await p.locator('input[type=file]').setInputFiles({name:'portrait.svg',mimeType:'image/svg+xml',buffer:svg});await p.waitForFunction(()=>model.images.length===1);await finish(p);
  await p.evaluate(async()=>{const data=new DataTransfer();data.items.add(await makeFile('drop.png'));const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:data});galleryQuery('.sig-gallery').dispatchEvent(event);});await p.waitForFunction(()=>model.images.length===2);await finish(p);
  assert.equal(await p.evaluate(()=>{const outside=document.createElement('p');document.querySelector('#host').append(outside);const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true});outside.dispatchEvent(e);return e.defaultPrevented;}),false);
 });
 await run('copied local assets are reused instead of uploading the accompanying clipboard bitmap',async p=>{
  await p.evaluate(async()=>{const dt=new DataTransfer();dt.items.add(await makeFile());dt.setData('text/html','<img src="'+location.origin+'/assets/copied.png?box=example" alt="Existing image">');galleryQuery('.sig-gallery').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await p.waitForFunction(()=>model.images.length===1);assert.equal(await p.evaluate(()=>model.images[0].src),'assets/copied.png?box=example');assert.equal(await p.evaluate(()=>calls.filter(x=>x.url==='/api/asset/upload').length),0);
 });
 await run('Base64 clipboard images are localized and not embedded in block JSON',async p=>{
  await p.evaluate(async()=>{const file=await makeFile(),reader=new FileReader(),data=await new Promise(r=>{reader.onload=()=>r(reader.result);reader.readAsDataURL(file);});const dt=new DataTransfer();dt.setData('text/html','<img src="'+data+'">');galleryQuery('.sig-gallery').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});await p.waitForFunction(()=>model.images.length===1);assert.ok(await p.evaluate(()=>model.images[0].src.startsWith('assets/')&&!raw.includes('base64')));
 });
 await run('partial upload failure preserves successes and reports the error',async p=>{
  await p.evaluate(async()=>{failNext=true;await plugin.importImages('20261113000000-abcdefg',{files:[await makeFile(),await makeFile()],refs:[]});});await p.waitForFunction(()=>model.images.length===1);assert.ok(await p.evaluate(()=>messages.some(x=>x[0].includes('disk full'))));
 });
 await run('mode changes while uploading merge the latest saved layout and keep imported images',async p=>{
  await seed(p);await p.evaluate(async()=>{delayUpload=300;window.job=plugin.importImages('20261113000000-abcdefg',{files:[await makeFile()],refs:[]});});await p.waitForFunction(()=>plugin.jobs.size===1);
  await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await p.waitForFunction(()=>model.images.length===3);await finish(p);assert.equal(await p.evaluate(()=>model.layout),'focus');assert.equal(await p.locator('.sig-stage').getAttribute('data-layout'),'focus');
 });
 await run('simultaneous recovery and mode saving serialize writes rather than coalescing stale image snapshots',async p=>{
  await seed(p);await p.evaluate(async()=>{
   plugin.pending.race={blockId:'20261113000000-abcdefg',images:[{id:'race-image',src:'assets/race.png',name:'',alt:'',width:1200,height:800}]};await plugin.persistPending();
   const protect=plugin.protect.bind(plugin);const gate=new Promise(resolve=>window.releaseProtect=resolve);window.inFlight=0;window.maxInFlight=0;
   plugin.protect=async(...args)=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);try{await gate;return await protect(...args);}finally{inFlight--;}};
  });
  await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>inFlight===1);
  await p.evaluate(()=>{window.restoreJob=Array.from(plugin.views.get('20261113000000-abcdefg'))[0].recover('race');});await p.waitForTimeout(40);assert.equal(await p.evaluate(()=>maxInFlight),1);
  await p.evaluate(()=>releaseProtect());await p.waitForFunction(()=>model.layout==='focus'&&model.images.length===3);assert.equal(await p.evaluate(()=>Object.keys(plugin.pending).length),0);
 });
 await run('rejected writes persist recovery and restore each uploaded image once',async p=>{
  await p.evaluate(async()=>{rejectWrites=true;await plugin.importImages('20261113000000-abcdefg',{files:[],refs:[{src:'assets/recovery.png',alt:'Recover me'}]});});assert.equal(await p.evaluate(()=>model.images.length),0);assert.equal(await p.evaluate(()=>Object.keys(store['pending.json']).length),1);
  await p.evaluate(async()=>{cleanup();plugin.onunload();plugin=new Gallery();await plugin.onload();rejectWrites=false;render(model);});await p.getByRole('button',{name:'恢复待插入图片',exact:true}).click();await p.waitForFunction(()=>model.images.length===1);assert.equal(await p.evaluate(()=>Object.keys(plugin.pending).length),0);assert.ok(await p.getByRole('button',{name:'恢复待插入图片',exact:true}).isHidden());
 });
 await run('closing the originating editor during upload retains recoverable images',async p=>{
  await p.evaluate(async()=>{delayUpload=200;window.job=plugin.importImages('20261113000000-abcdefg',{files:[await makeFile()],refs:[]});cleanup();closed=true;document.querySelector('#mount').replaceChildren();});await finish(p);assert.equal(await p.evaluate(()=>Object.keys(plugin.pending).length),1);
  await p.evaluate(()=>render(model));await p.getByRole('button',{name:'恢复待插入图片',exact:true}).click();await p.waitForFunction(()=>model.images.length===1);
 });
 await run('readonly modes and previews work locally without any kernel writes',async p=>{
  await seed(p);await p.evaluate(()=>{siyuan.config.readonly=true;render(model);});await settle(p);const before=await p.evaluate(()=>calls.length);
  await p.getByRole('button',{name:'主图',exact:true}).click();await settle(p);assert.equal(await p.locator('.sig-stage').getAttribute('data-layout'),'focus');await p.getByRole('button',{name:'选择第 2 张图片',exact:true}).click();await p.locator('.sig-photo').click();await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>calls.length),before);assert.ok(await p.getByRole('button',{name:'添加图片',exact:true}).isHidden());assert.ok(await p.getByRole('button',{name:'编辑',exact:true}).isHidden());
 });
 await run('v1 source is readable without content rewrite until the first intentional edit',async p=>{
  await p.evaluate(()=>render({version:1,layout:'grid',height:210,gap:10,captions:true,images:[{id:'old-a',src:'assets/sample-0.svg',alt:'Old caption',width:1200,height:850}]}));await settle(p);
  assert.equal(await p.evaluate(()=>model.version),1);assert.equal(await p.locator('.sig-stage').getAttribute('data-layout'),'row');assert.equal(await p.locator('figcaption').textContent(),'Old caption');
  await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.version===2);assert.equal(await p.evaluate(()=>model.images[0].id),'old-a');assert.equal(await p.evaluate(()=>model.images[0].alt),'Old caption');
 });
 await run('corrupt or newer block formats remain visible and are never overwritten',async p=>{
  const before=await p.evaluate(()=>calls.length);await p.evaluate(()=>render('{"version":99,"images":[]}'));assert.ok(await p.locator('.sig-invalid').isVisible());assert.match(await p.locator('.sig-invalid pre').textContent(),/"version":99/);assert.equal(await p.evaluate(()=>calls.length),before);
 });
 await run('Markdown export and saved image-size/caption settings retain real content',async p=>{
  await seed(p);await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.exported=text;}}}));await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByText('链接与导出',{exact:true}).click();await p.getByRole('button',{name:'复制图片 Markdown',exact:true}).click();assert.match(await p.evaluate(()=>exported),/assets\/sample-0.svg/);
  await p.getByRole('slider',{name:'图片大小',exact:true}).evaluate(e=>{e.value='1.2';e.dispatchEvent(new Event('change',{bubbles:true}));});await p.waitForFunction(()=>model.size===1.2);assert.ok(await p.getByRole('button',{name:'完成',exact:true}).isVisible());
 });
 await run('remote streams are bounded and invalid remote formats are rejected',async p=>{
  const result=await p.evaluate(async()=>{const prior=fetch;let canceled=false;window.fetch=async()=>({ok:true,headers:new Headers({'content-type':'image/png'}),body:{getReader:()=>({read:async()=>({done:false,value:{byteLength:51*1024*1024}}),cancel:async()=>{canceled=true;},releaseLock(){}})}});let msg='';try{await plugin.remote({src:'https://example.com/huge',alt:''},0);}catch(e){msg=e.message;}window.fetch=prior;return{canceled,msg};});assert.ok(result.canceled);assert.match(result.msg,/50 MiB/);
  const bad=await p.evaluate(async()=>{const prior=fetch;window.fetch=async()=>new Response('<html>not an image</html>',{headers:{'content-type':'text/html'}});try{await plugin.remote({src:'https://example.com/page',alt:''},0);return '';}catch(e){return e.message;}finally{window.fetch=prior;}});assert.match(bad,/图片类型/);
  await p.route('https://example.com/image.svg',r=>r.fulfill({headers:{'content-type':'image/svg+xml; charset=utf-8','access-control-allow-origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#eee"/></svg>'}));
  const good=await p.evaluate(()=>plugin.remote({src:'https://example.com/image.svg',alt:'Remote caption'},0));assert.ok(good.src.startsWith('assets/'));assert.equal(good.alt,'Remote caption');
 });
 await run('disable aborts pending imports, removes observers/listeners and makes no late writes',async p=>{
  await p.evaluate(async()=>{delayUpload=500;window.job=plugin.importImages('20261113000000-abcdefg',{files:[await makeFile()],refs:[]});});await p.waitForFunction(()=>calls.some(x=>x.url==='/api/asset/upload'));
  const count=await p.evaluate(()=>{plugin.onunload();return calls.length;});await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>calls.length),count);assert.equal(await p.evaluate(()=>plugin.views.size),0);assert.equal(await p.evaluate(()=>plugin.jobs.size),0);
 });
 await run('dark theme, narrow controls and reduced motion keep layout and navigation usable',async p=>{
  await seed(p);await p.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await p.setViewportSize({width:375,height:900});await settle(p);await p.getByRole('button',{name:'主图',exact:true}).click();await p.waitForFunction(()=>model.layout==='focus');await settle(p);
  assert.ok(await p.locator('.sig-thumbs').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return Math.abs((a.left+a.right)/2-(b.left+b.right)/2)<1;}));
  assert.equal(await p.locator('.sig-toolbar').evaluate(e=>{const r=e.getBoundingClientRect();return[...e.querySelectorAll('button:not([hidden])')].every(b=>b.getBoundingClientRect().right<=r.right+1);}),true);
 });
 fs.writeFileSync(path.join(__dirname,'browser-result.json'),JSON.stringify({status:'passed',tests:report.length,bundleSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(fixture.root,'dist','index.js'))).digest('hex'),cases:report,environment:'Headless Chromium with exact shipped bundle, mock SiYuan SDK/kernel; not a real SiYuan installation.'},null,2));
 console.log('All '+report.length+' browser tests passed.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
