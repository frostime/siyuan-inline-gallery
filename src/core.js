/* Pure data and sizing helpers. Version 1 is read without changing stored data. */
'use strict';

// Fallbacks applied by normalize(); missing version-2 fields fall back to these.
// New galleries open in the main-image view; this only seeds the stored data.
const DEFAULTS = {version: 2, layout: 'focus', size: 1, gap: 16, captions: false, images: []};

const clamp = (n, lo, hi, fallback) => Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : fallback;

function source(value) {
    if (typeof value !== 'string') return '';
    let cleaned = value.trim().replace(/&amp;/g, '&');
    // Accept "./assets/..." and "/assets/..." as plain "assets/..." references.
    cleaned = cleaned.replace(/^(?:\.\/|\/)(?=assets\/)/, '');
    // Control characters and backslashes never occur in a valid path or URL.
    if (!cleaned || /[\u0000-\u001f\\]/.test(cleaned)) return '';
    if (cleaned.startsWith('assets/')) {
        // Reject traversal only in the path part; query and hash may contain anything.
        let decodedPath;
        try { decodedPath = decodeURIComponent(cleaned.split(/[?#]/)[0]); } catch { return ''; }
        if (decodedPath.split('/').some(part => part === '..' || part === '.')) return '';
        return cleaned;
    }
    // Non-assets sources must be http(s) URLs without embedded credentials.
    try {
        const url = new URL(cleaned);
        const isHttp = ['http:', 'https:'].includes(url.protocol);
        return isHttp && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

function normalize(input) {
    if (!input || ![1, 2].includes(input.version) || !Array.isArray(input.images)) {
        throw new Error('无法识别画廊数据；请保留原始内容并检查 version 和 images。');
    }
    const usedIds = new Set();
    const images = input.images.map(item => {
        const src = source(item?.src);
        if (!src) throw new Error('图片路径无效：' + String(item?.src).slice(0, 100));
        const idIsValid = typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id);
        let id = idIsValid ? item.id : uid();
        if (usedIds.has(id)) id = uid();
        usedIds.add(id);
        return {id, src, alt: String(item.alt || '').slice(0, 2000), name: String(item.name || '').slice(0, 500),
            width: clamp(item.width, 0, 100000, 0), height: clamp(item.height, 0, 100000, 0)};
    });
    // Version 1 had no main-image view, so every v1 layout migrates to row.
    const layout = input.version === 1 || input.layout === 'row' ? 'row' : DEFAULTS.layout;
    // Old fixed heights are deliberately not carried into the new responsive UI.
    return {...DEFAULTS, layout,
        size: input.version === 2 ? clamp(input.size, .6, 1.5, 1) : 1,
        gap: clamp(input.gap, 0, 32, 16), captions: !!input.captions, images};
}

function parse(raw) { return normalize(JSON.parse(raw || JSON.stringify(DEFAULTS))); }

function serialize(model) { return JSON.stringify(normalize(model), null, 2); }

function ratio(image) { return image.width > 0 && image.height > 0 ? image.width / image.height : 1.5; }

function rowFrames(images, width, size = 1) {
    if (!Number.isFinite(width) || width <= 0) return [];
    // Size is independent of image count. Extra images always extend the row.
    const base = width < 560 ? width * .62 : Math.min(640, Math.max(420, width * .5));
    const height = Math.max(100, base * clamp(size, .6, 1.5, 1));
    return images.map(image => {
        const aspect = ratio(image);
        const cardWidth = Math.min(width * .88, Math.max(60, height * aspect));
        // A complete card must fit in the row viewport. Wide screenshots get
        // a proportionally shorter frame instead of exceeding two viewports.
        return {width: cardWidth, height: Math.max(80, Math.min(height, cardWidth / aspect))};
    });
}

function focusFrame(image, width, size = 1) {
    return {width, height: Math.max(80, Math.min(640 * clamp(size, .6, 1.5, 1), width / ratio(image)))};
}

function markdown(images) {
    return images.map(image =>
        '![' + image.alt.replace(/[\[\]\\\r\n]/g, ' ') +
        '](<' + image.src.replace(/</g, '%3C').replace(/>/g, '%3E') + '>)'
    ).join('\n');
}

function textImages(text) {
    const found = [];
    const imagePattern = /!\[([^\]]*)\]\(/g;
    let match;
    while ((match = imagePattern.exec(text))) {
        // Each match is "![alt](" followed by either <link> or (link "title").
        const alt = match[1];
        let rawTarget = '';
        if (text[imagePattern.lastIndex] === '<') {
            const angleEnd = text.indexOf('>', imagePattern.lastIndex);
            if (angleEnd < 0) continue;
            rawTarget = text.slice(imagePattern.lastIndex + 1, angleEnd);
            imagePattern.lastIndex = angleEnd + 1;
        }
        if (!rawTarget) {
            // Scan a parenthesized target; a backslash escapes the next character.
            let depth = 1;
            let end = imagePattern.lastIndex;
            for (; end < text.length; end++) {
                if (text[end] === '\\') { end++; continue; }
                if (text[end] === '(') depth++;
                if (text[end] === ')' && --depth === 0) break;
            }
            // Drop a trailing "title" after whitespace, then trim.
            rawTarget = text.slice(imagePattern.lastIndex, end)
                .replace(/\s+["'][\s\S]*["']\s*$/, '').trim();
            imagePattern.lastIndex = end + 1;
        }
        const src = source(rawTarget);
        if (src) found.push({src, alt});
    }
    // Fallback: treat each bare line as a plain path or URL.
    if (!found.length) {
        for (const line of text.split(/\r?\n/)) {
            const src = source(line.trim().replace(/^<|>$/g, ''));
            if (src) found.push({src, alt: ''});
        }
    }
    return found;
}

module.exports = {DEFAULTS, clamp, source, uid, normalize, parse, serialize, ratio, rowFrames, focusFrame, markdown, textImages};
