/* Pure data and sizing helpers. Version 1 is read without changing stored data. */
'use strict';
const DEFAULTS = {version:2,layout:'row',size:1,gap:16,captions:false,images:[]};
const clamp = (n, lo, hi, fallback) => Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : fallback;
function source(value) {
    if (typeof value !== 'string') return '';
    let s = value.trim().replace(/&amp;/g, '&');
    s = s.replace(/^(?:\.\/|\/)(?=assets\/)/, '');
    if (!s || /[\u0000-\u001f\\]/.test(s)) return '';
    if (s.startsWith('assets/')) {
        let decoded;
        try { decoded = decodeURIComponent(s.split(/[?#]/)[0]); } catch { return ''; }
        if (decoded.split('/').some(p => p === '..' || p === '.')) return '';
        return s;
    }
    try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function normalize(input) {
    if (!input || ![1,2].includes(input.version) || !Array.isArray(input.images)) throw new Error('无法识别画廊数据；请保留原始内容并检查 version 和 images。');
    const ids = new Set();
    const images = input.images.map(item => {
        const src = source(item?.src);
        if (!src) throw new Error('图片路径无效：' + String(item?.src).slice(0, 100));
        let id = typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ? item.id : uid();
        if (ids.has(id)) id = uid(); ids.add(id);
        return {id,src,alt:String(item.alt || '').slice(0,2000),name:String(item.name || '').slice(0,500),width:clamp(item.width,0,100000,0),height:clamp(item.height,0,100000,0)};
    });
    // Old fixed heights are deliberately not carried into the new responsive UI.
    return {...DEFAULTS,layout:input.layout === 'focus' ? 'focus' : 'row',size:input.version === 2 ? clamp(input.size,.6,1.5,1) : 1,gap:clamp(input.gap,0,32,16),captions:!!input.captions,images};
}
function parse(raw) { return normalize(JSON.parse(raw || JSON.stringify(DEFAULTS))); }
function serialize(model) { return JSON.stringify(normalize(model), null, 2); }
function ratio(image) { return image.width > 0 && image.height > 0 ? image.width / image.height : 1.5; }
function rowFrames(images,width,size=1) {
    if (!Number.isFinite(width) || width <= 0) return [];
    // Size is independent of image count. Extra images always extend the row.
    const base = width < 560 ? width*.62 : Math.min(640,Math.max(420,width*.5));
    const height = Math.max(100,base*clamp(size,.6,1.5,1));
    return images.map(image => {
        const r=ratio(image),w=Math.min(width*.88,Math.max(60,height*r));
        // A complete card must fit in the row viewport. Wide screenshots get
        // a proportionally shorter frame instead of exceeding two viewports.
        return {width:w,height:Math.max(80,Math.min(height,w/r))};
    });
}
function focusFrame(image,width,size=1) {
    return {width,height:Math.max(80,Math.min(640*clamp(size,.6,1.5,1),width/ratio(image)))};
}
function markdown(images) { return images.map(i => '![' + i.alt.replace(/[\[\]\\\r\n]/g, ' ') + '](<' + i.src.replace(/</g,'%3C').replace(/>/g,'%3E') + '>)').join('\n'); }
function textImages(text) {
    const found = []; const re = /!\[([^\]]*)\]\(/g; let m;
    while ((m = re.exec(text))) {
        let pos = re.lastIndex, raw = '', depth = 1;
        if (text[pos] === '<') { const end = text.indexOf('>',pos); if (end < 0) continue; raw = text.slice(pos+1,end); re.lastIndex=end+1; }
        if (!raw) {
            pos=re.lastIndex;depth=1;let end=pos;
            for (;end<text.length;end++) {if(text[end]==='\\'){end++;continue;}if(text[end]==='(')depth++;if(text[end]===')'&&--depth===0)break;}
            raw=text.slice(pos,end).replace(/\s+["'][\s\S]*["']\s*$/,'').trim();re.lastIndex=end+1;
        }
        const src=source(raw);if(src)found.push({src,alt:m[1]});
    }
    if(!found.length)for(const line of text.split(/\r?\n/)){const src=source(line.trim().replace(/^<|>$/g,''));if(src)found.push({src,alt:''});}
    return found;
}
module.exports={DEFAULTS,clamp,source,uid,normalize,parse,serialize,ratio,rowFrames,focusFrame,markdown,textImages};
