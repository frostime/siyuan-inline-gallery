'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core');
const image=(w,h,id='x')=>({id,src:'assets/'+id+'.png',alt:'',name:'',width:w,height:h});
test('new galleries default to the scrollable row; valid models round trip',()=>{
 assert.equal(C.DEFAULTS.layout,'row');assert.equal(C.DEFAULTS.version,2);
 const m=C.normalize({...C.DEFAULTS,size:99,gap:-4,images:[image(1200,800)]});assert.equal(m.size,1.5);assert.equal(m.gap,0);assert.deepEqual(C.parse(C.serialize(m)),m);
 assert.throws(()=>C.parse('{bad'));assert.throws(()=>C.normalize({version:99,images:[]}));
});
test('v1 galleries migrate without losing image order, IDs, paths or captions',()=>{
 for(const layout of ['row','grid','masonry','justified']){
  const images=[{...image(300,800,'a'),alt:'Caption A'},{...image(1200,800,'b'),alt:'Caption B'}];
  const m=C.normalize({version:1,layout,height:210,minWidth:180,gap:10,captions:true,images});
  assert.equal(m.version,2);assert.equal(m.layout,'row');assert.equal(m.size,1);assert.equal(m.gap,10);assert.equal(m.captions,true);assert.deepEqual(m.images,images);
 }
});
test('row frame sizes are independent of image count and two sample images overflow',()=>{
 const samples=[image(324,231,'a'),image(258,227,'b')];
 for(const width of [300,720,1024,1500]){
  const boxes=C.rowFrames(samples,width);assert.ok(boxes.reduce((sum,b)=>sum+b.width,16)>width);
  assert.deepEqual(C.rowFrames([...samples,...samples],width)[0],boxes[0]);
  assert.ok(boxes.every(b=>b.width>0&&b.height>0&&Number.isFinite(b.width)));
 }
 assert.ok(C.rowFrames(samples,1024)[0].height>450);assert.deepEqual(C.rowFrames(samples,0),[]);
});
test('extreme image ratios get finite frames and focus view stays within its width',()=>{
 for(const img of [image(100000,1),image(1,100000),image(0,0)])for(const width of [160,320,1024]){
  const frame=C.rowFrames([img],width)[0];assert.ok(frame.width<=width*.88+.001);assert.ok(frame.height>=80);
  const focus=C.focusFrame(img,width);assert.equal(focus.width,width);assert.ok(focus.height>=80&&focus.height<=640);
 }
});
test('path validator rejects traversal, executable schemes, credentials and file URLs',()=>{
 for(const value of ['javascript:alert(1)','file:///tmp/a.png','data:image/png;base64,AA','assets/../secret','assets/%2e%2e/x','assets/%2e%2e%2fx','assets/\\x','https://user:pw@example.com/a'])assert.equal(C.source(value),'',value);
 assert.equal(C.source('./assets/a b.png?box=123'),'assets/a b.png?box=123');assert.equal(C.source('/assets/a,b.png'),'assets/a,b.png');assert.equal(C.source('https://example.com/a.png'),'https://example.com/a.png');
});
test('Markdown import/export accepts spaces, parentheses and titles',()=>{
 assert.deepEqual(C.textImages('![a](assets/a(b).png)\n![b](<assets/c d.png>)\n![c](assets/e.png "title")').map(x=>x.src),['assets/a(b).png','assets/c d.png','assets/e.png']);
 assert.equal(C.textImages('assets/a.png\nhttps://example.com/b.png').length,2);
 const imgs=[{...image(1,1),src:'assets/a b.png',alt:'[caption]\ntext'}];assert.equal(C.textImages(C.markdown(imgs))[0].src,'assets/a b.png');
});
test('duplicated IDs are repaired without discarding repeated images',()=>{
 const m=C.normalize({...C.DEFAULTS,images:[image(1,1),image(2,2)]});assert.equal(m.images.length,2);assert.notEqual(m.images[0].id,m.images[1].id);
});
