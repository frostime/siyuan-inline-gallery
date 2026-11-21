'use strict';

const C = require('./core.js');
const Icons = require('./icons.js');
const Styles = require('./styles.js');

// Breathing room kept around the lightbox image, in CSS pixels.
const PORT_PADDING = 32;

const el = (doc, tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
};
// The kernel serves workspace assets from the site root; other sources pass through.
const imageURL = src => src.startsWith('assets/') ? '/' + src : src;
const message = error => error?.message || String(error);
// Same rule as plugin-side isReadonly(): publish/readonly mode, or a non-editable editor.
const readonly = element => !!(window.siyuan?.config?.readonly || window.siyuan?.isPublish ||
    element.closest('.protyle-wysiwyg')?.getAttribute('contenteditable') === 'false');

function icon(doc, name) {
    const node = el(doc, 'span', 'sig-glyph');
    node.innerHTML = Icons[name] || Icons.focus;
    return node;
}

// File-picker filter; more permissive than plugin-side validFile().
const isImageFile = file => /^image\//i.test(file.type) ||
    /\.(png|jpe?g|gif|webp|avif|bmp|svg|tiff?|heic|heif)$/i.test(file.name);

const fileName = src => src.split(/[?#]/)[0].split('/').pop() || src;
// Chromium accepts only image/png on the clipboard write path, so other formats
// are re-encoded. Decoding via a blob URL keeps the canvas same-origin (no
// tainting) and also covers SVG sources.
async function clipboardImage(win, doc, url) {
    const response = await win.fetch(url);
    if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (blob.type === 'image/png') return blob;
    const objectURL = win.URL.createObjectURL(blob);
    try {
        const img = new win.Image();
        img.src = objectURL;
        await img.decode();
        const canvas = doc.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return await new Promise((resolve, reject) => canvas.toBlob(
            png => png ? resolve(png) : reject(new Error('图片无法转换为 PNG')), 'image/png'));
    } finally { win.URL.revokeObjectURL(objectURL); }
}
// Verified failure shapes: a cross-origin fetch without CORS rejects with a
// TypeError, an undecodable image with DOMException "EncodingError", a refused
// clipboard write with DOMException "NotAllowedError". The browser's own text
// for those is not a next step, so each case gets one.
const copyFailure = (win, error) => {
    if (error instanceof win.TypeError) return '无法读取图片数据；跨域链接的图片请先下载到 assets 再复制。';
    if (error?.name === 'EncodingError') return '图片无法解码，可能已损坏。';
    if (error instanceof win.DOMException) return '剪贴板写入被拒绝；请确认窗口在前台，并允许剪贴板权限。';
    return message(error);
};
// Import prefers Markdown image syntax and ignores other lines. The preview
// counts those instead of letting them disappear without a trace.
function unparsedLineCount(text, refs) {
    const candidates = text.split(/\r?\n/).map(line => line.trim())
        .filter(line => /(?:assets\/|https?:\/\/|!\[)/.test(line));
    return candidates.filter(line => !refs.some(ref => line.includes(ref.src))).length;
}

module.exports = function renderGallery(plugin, {element, content, setContent}) {
    const doc = element.ownerDocument, win = doc.defaultView;
    const id = element.closest('[data-type="NodeCustomBlock"]')?.getAttribute('data-node-id') || '';
    // Prefixing classes cannot isolate generic editor/theme rules such as
    // svg { fill: currentColor } or important image declarations.
    const host = el(doc, 'div', 'sig-gallery-host');
    host.contentEditable = 'false';
    host.setAttribute('data-inline-gallery', '');
    const shadow = host.attachShadow({mode: 'open'});
    const style = el(doc, 'style');
    style.textContent = Styles;
    shadow.append(style);
    element.append(host);

    let model;
    try {
        model = C.parse(content);
    } catch (error) {
        const fallback = el(doc, 'div', 'sig-gallery sig-invalid');
        fallback.append(el(doc, 'p', '', message(error)), el(doc, 'pre', '', content));
        shadow.append(fallback);
        return;
    }

    const state = plugin.ui.get(id) || {scroll: 0, activeId: null, editing: false, editingTab: 'images', dimensions: new Map()};
    plugin.ui.set(id, state);
    state.dimensions ||= new Map();
    state.editingTab ||= 'images';
    let displayMode = readonly(element) ? (state.readMode || model.layout) : model.layout;

    let disposed = false, saving = false, frame = 0, noticeTimer = 0, stageEvents = new AbortController(), restoreRow = true;
    let saveFinished = Promise.resolve(), releaseSave = null;
    // One writer at a time: the save lock serializes commit()/recover() against
    // each other so neither merges with an earlier images snapshot.
    const lockSave = () => { saving = true; saveFinished = new Promise(resolve => { releaseSave = resolve; }); busy(); };
    const unlockSave = () => { saving = false; releaseSave?.(); releaseSave = null; if (!disposed) busy(); };
    const events = new AbortController(), signal = events.signal;

    const root = el(doc, 'section', 'sig-gallery');
    root.tabIndex = 0; root.contentEditable = 'false'; root.setAttribute('aria-label', '图片画廊');
    const toolbar = el(doc, 'div', 'sig-toolbar');
    const modes = el(doc, 'div', 'sig-modes');
    modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '显示方式');
    const writable = () => !disposed && !!id && !readonly(element) && !plugin.stopped;
    const mutable = [];

    const button = (label, glyph, handler, parent = toolbar, options = {}) => {
        const b = el(doc, 'button', options.text ? 'sig-button' : 'sig-button sig-icon', options.text ? label : undefined);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.title = label;
        if (glyph) b.prepend(icon(doc, glyph));
        b.addEventListener('click', handler, {signal: options.signal || signal});
        parent.append(b);
        return b;
    };

    const status = el(doc, 'div', 'sig-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
    const warn = error => {
        if (disposed) return;
        clearTimeout(noticeTimer);
        status.classList.add('sig-error');
        status.textContent = message(error);
        status.hidden = false;
    };
    const notice = text => {
        if (disposed) return;
        status.classList.remove('sig-error');
        status.textContent = text;
        status.hidden = false;
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => { if (!disposed) { status.textContent = ''; status.hidden = true; } }, 3500);
    };

    const stage = el(doc, 'div', 'sig-stage');
    const panel = el(doc, 'div', 'sig-panel');
    // One rAF-coalesced layout pass: hidden galleries report width 0 and skip.
    const schedule = () => { if (!disposed && !frame) frame = win.requestAnimationFrame(() => { frame = 0; layout(); }); };
    const picker = el(doc, 'input', 'sig-hidden');
    picker.type = 'file'; picker.multiple = true; picker.accept = 'image/*';
    picker.addEventListener('change', () => {
        const files = Array.from(picker.files || []).filter(isImageFile);
        picker.value = '';
        if (files.length && writable()) plugin.importImages(id, {files, refs: []});
    }, {signal});

    const selectedIndex = () => {
        const index = model.images.findIndex(x => x.id === state.activeId);
        return index < 0 ? 0 : index;
    };
    const selected = () => model.images[selectedIndex()];
    const measured = image => ({...image, ...state.dimensions.get(image.src)});
    const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const commit = async (patch, {duringImport = false} = {}) => {
        if (!writable() || saving || (!duringImport && plugin.jobs.has(id))) return false;
        lockSave();
        try {
            const nextModel = C.normalize({...model, ...patch});
            await plugin.protect(id, nextModel.images);
            if (!writable()) return false;
            if (!setContent(C.serialize(nextModel))) throw new Error('当前画廊无法写入，请检查只读状态后重试。');
            model = nextModel;
            return true;
        } catch (error) { warn(error); return false; }
        finally { unlockSave(); }
    };

    const setMode = async mode => {
        if (mode === displayMode || saving) return;
        const prior = displayMode;
        if (prior === 'row') state.scroll = stage.scrollLeft;
        displayMode = mode; restoreRow = true;
        renderStage(); sync();
        if (!writable()) { state.readMode = mode; return; }
        // The optimistic re-render above is rolled back when the save fails.
        if (!await commit({layout: mode}, {duringImport: true}) && !disposed) {
            displayMode = prior; restoreRow = true;
            renderStage(); sync();
        }
    };

    // Main-image view is listed (and used) first, matching the default layout.
    const focusButton = button('主图', 'focus', () => setMode('focus'), modes);
    const rowButton = button('横排', 'row', () => setMode('row'), modes);
    toolbar.append(modes);

    const move = offset => {
        if (!model.images.length) return;
        if (displayMode === 'row') {
            stage.scrollBy({left: stage.clientWidth * .8 * offset, behavior: reduced() ? 'auto' : 'smooth'});
            return;
        }
        const nextIndex = Math.max(0, Math.min(model.images.length - 1, selectedIndex() + offset));
        state.activeId = model.images[nextIndex].id;
        renderStage(); sync();
    };
    const prev = button('上一张', 'prev', () => move(-1));
    const counter = el(doc, 'span', 'sig-counter');
    const next = button('下一张', 'next', () => move(1));
    toolbar.insertBefore(counter, next);
    toolbar.append(el(doc, 'span', 'sig-spacer'));
    const working = el(doc, 'span', 'sig-working');
    working.setAttribute('role', 'status'); working.setAttribute('aria-label', '正在保存图片'); working.title = '正在保存图片';
    working.append(icon(doc, 'spinner'));
    toolbar.append(working);
    const recovery = button('恢复待插入图片', 'recover', () => recover().catch(warn));
    const add = button('添加图片', 'add', () => picker.click());
    mutable.push(add);
    const edit = button('编辑', 'edit', () => setEditing(!state.editing));
    mutable.push(edit);

    function sync() {
        if (disposed) return;
        rowButton.setAttribute('aria-pressed', String(displayMode === 'row'));
        focusButton.setAttribute('aria-pressed', String(displayMode === 'focus'));
        rowButton.disabled = focusButton.disabled = saving;
        const count = model.images.length, index = selectedIndex();
        counter.hidden = displayMode !== 'focus' || !count;
        counter.textContent = count ? `${index + 1} / ${count}` : '';
        if (displayMode === 'row') {
            const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
            prev.hidden = next.hidden = max < 2;
            prev.disabled = stage.scrollLeft < 2;
            next.disabled = stage.scrollLeft >= max - 2;
        } else {
            prev.hidden = next.hidden = count < 2;
            prev.disabled = index === 0;
            next.disabled = index >= count - 1;
        }
    }

    function busy() {
        if (disposed) return;
        const active = plugin.jobs.has(id) || saving;
        root.setAttribute('aria-busy', String(active));
        working.hidden = !active;
        for (const control of mutable) control.disabled = active || !writable() || control.dataset.edge === 'true';
        add.hidden = !writable();
        syncEditMode();
        recovery.hidden = !writable() || !Object.values(plugin.pending).some(v => v.blockId === id);
        recovery.disabled = active || !writable();
        sync();
    }

    // ── Editing panel: an explicit edit mode with two tabs ──────────────────
    // Edit mode replaces the gallery instead of stacking on top of it. The
    // "display" tab keeps the gallery visible, because size and gap changes
    // need live feedback; the "images" tab hides it, because reordering and
    // captions do not.
    const panelEvents = new AbortController(), panelSignal = panelEvents.signal;

    const editHead = el(doc, 'div', 'sig-edit-head');
    editHead.append(el(doc, 'span', 'sig-edit-title', `编辑图片画廊 · ${model.images.length} 张`));
    editHead.append(el(doc, 'span', 'sig-spacer'));
    const finish = button('完成', 'done', () => setEditing(false), editHead, {text: true, signal: panelSignal});
    mutable.push(finish);

    const tabs = el(doc, 'div', 'sig-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '编辑分区');
    const imagesView = el(doc, 'div', 'sig-edit-view');
    const displayView = el(doc, 'div', 'sig-edit-view');
    let imagesTab = null, displayTab = null;
    const selectTab = name => {
        state.editingTab = name === 'display' ? 'display' : 'images';
        if (imagesTab) imagesTab.setAttribute('aria-selected', String(state.editingTab === 'images'));
        if (displayTab) displayTab.setAttribute('aria-selected', String(state.editingTab === 'display'));
        imagesView.hidden = state.editingTab !== 'images';
        displayView.hidden = state.editingTab !== 'display';
        syncEditMode();
        schedule();
    };
    const tab = (label, name) => {
        const node = el(doc, 'button', 'sig-tab', label);
        node.type = 'button';
        node.setAttribute('role', 'tab');
        node.addEventListener('click', () => selectTab(name), {signal: panelSignal});
        tabs.append(node);
        return node;
    };
    imagesTab = tab('图片', 'images');
    displayTab = tab('显示', 'display');
    panel.append(editHead, tabs, imagesView, displayView);

    function syncEditMode() {
        if (disposed) return;
        const editing = state.editing && writable();
        panel.hidden = !editing;
        // The gallery doubles as the live preview while tuning size and gap.
        stage.hidden = editing && state.editingTab !== 'display';
        edit.hidden = !writable() || editing;
    }
    function setEditing(value) {
        state.editing = value;
        syncEditMode();
        schedule();
        if (disposed) return;
        (value ? finish : edit).focus({preventScroll: true});
    }

    const settings = el(doc, 'div', 'sig-settings');
    const sizeLabel = el(doc, 'label', 'sig-field', '图片大小');
    const size = el(doc, 'input', 'sig-range');
    const sizeValue = el(doc, 'span', 'sig-size-value', Math.round(model.size * 100) + '%');
    size.type = 'range'; size.min = '.6'; size.max = '1.5'; size.step = '.05'; size.value = model.size;
    size.setAttribute('aria-label', '图片大小');
    size.addEventListener('input', () => { sizeValue.textContent = Math.round(Number(size.value) * 100) + '%'; }, {signal});
    size.addEventListener('change', () => commit({size: Number(size.value)}), {signal});
    sizeLabel.append(size, sizeValue);
    settings.append(sizeLabel);
    mutable.push(size);

    const gapLabel = el(doc, 'label', 'sig-field', '间距');
    const gap = el(doc, 'input', 'sig-number');
    gap.type = 'number'; gap.min = 0; gap.max = 32; gap.value = model.gap;
    gap.setAttribute('aria-label', '图片间距');
    gap.addEventListener('change', () => commit({gap: C.clamp(gap.value, 0, 32, 16)}), {signal});
    gapLabel.append(gap);
    settings.append(gapLabel);
    mutable.push(gap);

    const captionLabel = el(doc, 'label', 'sig-field', '显示说明');
    const captions = el(doc, 'input');
    captions.type = 'checkbox'; captions.checked = model.captions;
    captions.addEventListener('change', () => commit({captions: captions.checked}), {signal});
    captionLabel.append(captions);
    settings.append(captionLabel);
    mutable.push(captions);
    displayView.append(settings);

    const listSection = el(doc, 'section', 'sig-edit-section');
    const list = el(doc, 'div', 'sig-list');
    listSection.append(list);
    imagesView.append(listSection);

    model.images.forEach((image, index) => {
        const item = el(doc, 'div', 'sig-item');
        const thumb = el(doc, 'img', 'sig-edit-thumb');
        thumb.src = imageURL(image.src); thumb.alt = ''; thumb.loading = 'lazy';
        const fields = el(doc, 'div', 'sig-edit-fields');
        fields.append(el(doc, 'span', 'sig-filename', image.name || image.src.split('/').pop()));
        const alt = el(doc, 'input', 'sig-alt');
        alt.value = image.alt;
        alt.placeholder = '添加图片说明';
        alt.setAttribute('aria-label', `第 ${index + 1} 张图片说明`);
        alt.addEventListener('change', () => commit({images: model.images.map(x => x.id === image.id ? {...x, alt: alt.value} : x)}), {signal});
        fields.append(alt);
        mutable.push(alt);
        const actions = el(doc, 'div', 'sig-item-actions');
        const shift = offset => {
            const images = [...model.images];
            const from = images.findIndex(x => x.id === image.id);
            const to = from + offset;
            if (to < 0 || to >= images.length) return;
            [images[from], images[to]] = [images[to], images[from]];
            commit({images});
        };
        const up = button('向前移动', 'up', () => shift(-1), actions);
        const down = button('向后移动', 'down', () => shift(1), actions);
        const remove = button('从画廊移除，保留资源文件', 'remove', () => commit({images: model.images.filter(x => x.id !== image.id)}), actions);
        up.dataset.edge = String(index === 0);
        down.dataset.edge = String(index === model.images.length - 1);
        mutable.push(up, down, remove);
        item.append(thumb, fields, actions);
        list.append(item);
    });

    // Import keeps one role: it reads text and shows what it parsed. Export
    // gets its own read-only output block instead of reusing this field.
    const addSection = el(doc, 'section', 'sig-edit-section');
    addSection.append(el(doc, 'h3', '', '添加图片'));
    const links = el(doc, 'textarea', 'sig-links');
    links.rows = 1;
    links.placeholder = '粘贴图片地址或 ![](…) Markdown';
    links.setAttribute('aria-label', '图片地址或 Markdown');
    addSection.append(links);
    const parseBox = el(doc, 'div', 'sig-parse');
    const parseNote = el(doc, 'p', 'sig-parse-note');
    addSection.append(parseBox, parseNote);
    // A one-line field that still accepts a multi-line paste: the input would
    // swallow the newlines.
    const growLinks = () => {
        links.style.height = 'auto';
        links.style.height = Math.min(120, links.scrollHeight + 2) + 'px';
    };
    const previewLinks = () => {
        growLinks();
        const text = links.value.trim();
        const refs = text ? C.textImages(text) : [];
        parseBox.replaceChildren(...refs.slice(0, 12).map(ref => {
            const chip = el(doc, 'span', 'sig-chip');
            chip.append(el(doc, 'span', '', fileName(ref.src)));
            if (/^https?:/i.test(ref.src)) chip.append(el(doc, 'em', '', '网络'));
            return chip;
        }));
        parseNote.hidden = !text;
        if (!text) return refs;
        const dropped = unparsedLineCount(text, refs);
        parseNote.textContent = refs.length
            ? `将导入 ${refs.length} 项` + (dropped ? `，另有 ${dropped} 行未被识别` : '')
            : '未识别到图片地址';
        return refs;
    };
    links.addEventListener('input', previewLinks, {signal: panelSignal});
    mutable.push(links);
    const importLinks = keep => {
        const refs = C.textImages(links.value);
        if (!refs.length) { warn(new Error('未找到有效图片路径。')); return; }
        plugin.importImages(id, {files: [], refs}, keep);
    };
    const linkActions = el(doc, 'div', 'sig-actions');
    mutable.push(
        button('下载到 assets', 'download', () => importLinks(false), linkActions, {text: true, signal: panelSignal}),
        button('保留外链', 'link', () => importLinks(true), linkActions, {text: true, signal: panelSignal}),
    );
    addSection.append(linkActions);
    imagesView.append(addSection);

    const exportSection = el(doc, 'section', 'sig-edit-section');
    exportSection.append(el(doc, 'h3', '', '导出'));
    const exportActions = el(doc, 'div', 'sig-actions');
    const exportOutput = el(doc, 'div');
    const copyMarkdown = async () => {
        const text = C.markdown(model.images);
        try {
            await win.navigator.clipboard.writeText(text);
            if (!disposed) notice('已复制 Markdown');
        } catch {
            if (disposed) return;
            const area = el(doc, 'textarea');
            area.readOnly = true; area.value = text;
            area.setAttribute('aria-label', '图片 Markdown');
            const box = el(doc, 'div', 'sig-output');
            box.append(el(doc, 'p', '', '剪贴板不可用，请手动复制下面的内容'), area);
            exportOutput.replaceChildren(box);
            area.focus(); area.select();
            if (doc.execCommand?.('copy')) notice('已复制 Markdown');
            else warn(new Error('剪贴板不可用，请手动复制下面的 Markdown。'));
        }
    };
    mutable.push(button('复制为 Markdown', 'copy', () => { copyMarkdown().catch(warn); }, exportActions, {text: true, signal: panelSignal}));
    exportSection.append(exportActions, exportOutput);
    imagesView.append(exportSection);

    selectTab(state.editingTab);

    // ── Stage: rendered cards and layout math ────────────────────────────────

    // Every card reserves the same caption slot, so captions never shift an image.
    const photo = (image, index, scope, captionClass = '') => {
        const card = el(doc, 'figure', 'sig-card');
        card.dataset.imageId = image.id;
        const openButton = button(`放大第 ${index + 1} 张图片`, '', () => openLightbox(index, openButton), card, {signal: scope});
        openButton.className = 'sig-photo';
        const img = el(doc, 'img');
        img.alt = image.alt || image.name || `图片 ${index + 1}`;
        img.loading = displayMode === 'focus' || index < 4 ? 'eager' : 'lazy';
        img.decoding = 'async'; img.draggable = false; img.referrerPolicy = 'no-referrer';
        img.addEventListener('load', () => {
            state.dimensions.set(image.src, {width: img.naturalWidth, height: img.naturalHeight});
            card.classList.remove('sig-broken');
            schedule();
        }, {signal: scope});
        img.addEventListener('error', () => {
            card.classList.add('sig-broken');
            openButton.title = '图片加载失败';
        }, {signal: scope});
        img.src = imageURL(image.src);
        const expand = el(doc, 'span', 'sig-expand');
        expand.append(icon(doc, 'expand'));
        openButton.append(img, expand);
        card.append(openButton);
        // An empty caption still occupies its slot: that is what keeps images aligned.
        if (model.captions) card.append(el(doc, 'figcaption', captionClass, image.alt));
        return card;
    };

    function renderStage() {
        stageEvents.abort();
        stageEvents = new AbortController();
        const scope = stageEvents.signal;
        stage.replaceChildren();
        stage.dataset.layout = displayMode;
        stage.setAttribute('aria-label', displayMode === 'row' ? '横排图片' : '主图与缩略图');
        stage.style.setProperty('--sig-gap', model.gap + 'px');
        if (!model.images.length) {
            const empty = el(doc, 'div', 'sig-empty');
            const plus = button('添加图片', 'add', () => picker.click(), empty, {signal: scope});
            plus.disabled = !writable() || plugin.jobs.has(id);
            stage.append(empty);
        } else if (displayMode === 'row') {
            model.images.forEach((image, index) => stage.append(photo(image, index, scope, '')));
        } else {
            const image = selected();
            state.activeId = image.id;
            const main = el(doc, 'div', 'sig-main');
            main.append(photo(image, selectedIndex(), scope, 'sig-caption-focus'));
            const thumbs = el(doc, 'div', 'sig-thumbs');
            thumbs.setAttribute('role', 'group');
            thumbs.setAttribute('aria-label', '选择图片');
            model.images.forEach((entry, index) => {
                const b = button(`选择第 ${index + 1} 张图片`, '', () => {
                    state.activeId = entry.id;
                    renderStage(); sync();
                    stage.querySelector('[data-selected="true"]')?.focus({preventScroll: true});
                }, thumbs, {signal: scope});
                b.className = 'sig-thumb';
                const active = entry.id === state.activeId;
                b.dataset.selected = String(active);
                b.setAttribute('aria-pressed', String(active));
                const img = el(doc, 'img');
                img.src = imageURL(entry.src);
                img.alt = entry.alt || entry.name || `图片 ${index + 1}`;
                img.loading = index < 6 ? 'eager' : 'lazy';
                img.draggable = false;
                b.append(img);
            });
            stage.append(main, thumbs);
        }
        schedule();
    }

    function layout() {
        if (disposed || !stage.clientWidth) return;
        const width = stage.clientWidth;
        if (displayMode === 'row') {
            const boxes = C.rowFrames(model.images.map(measured), width, model.size);
            stage.querySelectorAll(':scope > .sig-card').forEach((card, index) => {
                const box = boxes[index];
                if (!box) return;
                card.style.width = box.width + 'px';
                card.querySelector('.sig-photo').style.height = box.height + 'px';
            });
            // restoreRow marks re-renders that replaced the stage DOM; the saved
            // scroll position is meaningful only right after such a re-render.
            if (restoreRow) { stage.scrollLeft = state.scroll || 0; restoreRow = false; }
        } else if (model.images.length) {
            const img = selected();
            const box = C.focusFrame(measured(img), width, model.size);
            stage.querySelector('.sig-main .sig-photo').style.height = box.height + 'px';
            const strip = stage.querySelector('.sig-thumbs');
            const active = strip.querySelector('[aria-pressed="true"]');
            // Center the active thumbnail in the strip.
            if (active) strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.clientWidth) / 2);
        }
        sync();
    }

    // ── Lightbox viewer ──────────────────────────────────────────────────────
    function openLightbox(start, trigger) {
        if (disposed || root.querySelector('dialog')) return;
        const controller = new AbortController(), dialogSignal = controller.signal;
        const dialog = el(doc, 'dialog', 'sig-lightbox');
        dialog.setAttribute('aria-label', '图片预览');
        const shell = el(doc, 'div', 'sig-lightbox-shell');
        const top = el(doc, 'div', 'sig-lightbox-top');
        const count = el(doc, 'span', 'sig-counter');
        const percent = el(doc, 'span', 'sig-zoom-value');
        top.append(count, el(doc, 'span', 'sig-spacer'));
        let current = start, scale = 1, fit = true, zoomFrame = 0;
        const port = el(doc, 'div', 'sig-lightbox-port');
        const img = el(doc, 'img', 'sig-lightbox-image');
        const caption = el(doc, 'div', 'sig-lightbox-caption');
        img.draggable = false; img.referrerPolicy = 'no-referrer';
        port.append(img);

        const paint = () => {
            if (disposed || !dialog.open) return;
            const stored = measured(model.images[current]);
            const imageWidth = img.naturalWidth || stored.width || 800;
            const imageHeight = img.naturalHeight || stored.height || 600;
            if (fit) scale = Math.min(
                Math.max(1, port.clientWidth - PORT_PADDING) / imageWidth,
                Math.max(1, port.clientHeight - PORT_PADDING) / imageHeight);
            scale = C.clamp(scale, .05, 12, 1);
            img.style.width = imageWidth * scale + 'px';
            img.style.height = imageHeight * scale + 'px';
            img.style.marginInline = imageWidth * scale < port.clientWidth - PORT_PADDING ? 'auto' : '0';
            img.style.alignSelf = imageHeight * scale < port.clientHeight - PORT_PADDING ? 'center' : 'flex-start';
            percent.textContent = Math.round(scale * 100) + '%';
            fitButton.setAttribute('aria-pressed', String(fit));
        };
        const deferPaint = () => { if (!zoomFrame) zoomFrame = win.requestAnimationFrame(() => { zoomFrame = 0; paint(); }); };

        button('缩小', 'minus', () => { fit = false; scale *= .8; paint(); }, top, {signal: dialogSignal});
        top.append(percent);
        button('放大', 'add', () => { fit = false; scale *= 1.25; paint(); }, top, {signal: dialogSignal});
        const fitButton = button('适应窗口', 'fit', () => { fit = true; paint(); }, top, {signal: dialogSignal});
        button('100%', '', () => { fit = false; scale = 1; paint(); }, top, {signal: dialogSignal, text: true});
        // Copy feedback belongs inside the dialog: a modal makes the toolbar
        // status element behind it unreachable and invisible.
        const copyNote = el(doc, 'span', 'sig-copy-note');
        copyNote.setAttribute('role', 'status'); copyNote.setAttribute('aria-live', 'polite');
        top.append(copyNote);
        let copyTimer = 0, copying = false;
        const say = (text, failed) => {
            clearTimeout(copyTimer);
            copyNote.classList.toggle('sig-error', !!failed);
            copyNote.textContent = text;
            if (!failed) copyTimer = setTimeout(() => { copyNote.textContent = ''; }, 2500);
        };
        // Copying does not disable the button: a disabled element loses focus and
        // the arrow keys would stop reaching the dialog. Re-entry is blocked instead.
        const copyImage = async () => {
            if (copying) return;
            copying = true;
            say('正在复制…');
            try {
                if (!win.navigator.clipboard?.write || typeof win.ClipboardItem !== 'function') {
                    throw new Error('当前环境不支持写入图片剪贴板');
                }
                const image = model.images[current];
                const blob = await clipboardImage(win, doc, imageURL(image.src));
                await win.navigator.clipboard.write([new win.ClipboardItem({[blob.type]: blob})]);
                say('已复制图片');
            } catch (error) { say(copyFailure(win, error), true); }
            finally { copying = false; }
        };
        button('复制图片', 'copy', () => { copyImage(); }, top, {signal: dialogSignal});
        const close = button('关闭预览', 'close', () => dialog.close(), top, {signal: dialogSignal});
        const nav = el(doc, 'div', 'sig-lightbox-nav');
        const show = () => {
            const image = model.images[current];
            count.textContent = `${current + 1} / ${model.images.length}`;
            caption.textContent = image.alt;
            caption.hidden = !image.alt;
            img.alt = image.alt || image.name || `图片 ${current + 1}`;
            img.src = imageURL(image.src);
            fit = true;
            port.scrollTop = port.scrollLeft = 0;
            deferPaint();
        };
        const advance = offset => { current = (current + offset + model.images.length) % model.images.length; show(); };
        button('上一张', 'prev', () => advance(-1), nav, {signal: dialogSignal});
        button('下一张', 'next', () => advance(1), nav, {signal: dialogSignal});
        nav.hidden = model.images.length < 2;
        shell.append(top, port, caption, nav);
        dialog.append(shell);
        root.append(dialog);
        img.addEventListener('load', deferPaint, {signal: dialogSignal});
        dialog.addEventListener('keydown', event => {
            event.stopPropagation();
            if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                advance(event.key === 'ArrowRight' ? 1 : -1);
            }
        }, {signal: dialogSignal});
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, {signal: dialogSignal});
        const observer = win.ResizeObserver ? new win.ResizeObserver(deferPaint) : null;
        observer?.observe(port);
        if (!observer) win.addEventListener('resize', deferPaint, {signal: dialogSignal});
        dialog.addEventListener('close', () => {
            controller.abort();
            observer?.disconnect();
            win.cancelAnimationFrame(zoomFrame);
            clearTimeout(copyTimer);
            dialog.remove();
            if (!disposed) trigger.focus({preventScroll: true});
        }, {once: true});
        try {
            dialog.showModal(); show(); close.focus();
        } catch (error) {
            controller.abort(); observer?.disconnect(); dialog.remove(); warn(error);
        }
    }

    const recover = async only => {
        // setContent coalesces same-turn writes in SiYuan. Never race an import
        // against a mode/settings save using an earlier images snapshot.
        if (saving) {
            await saveFinished;
            if (disposed) {
                const live = Array.from(plugin.views.get(id) || []).find(v => v !== view && v.writable());
                return live?.recover(only);
            }
        }
        if (!writable()) throw new Error('当前画廊只读');
        const entries = Object.entries(plugin.pending).filter(([key, v]) => v.blockId === id && (!only || key === only));
        const additions = entries.flatMap(([, v]) => v.images || []);
        if (!additions.length) return;
        lockSave();
        try {
            await plugin.protect(id, additions);
            if (!writable()) return;
            const known = new Set(model.images.map(x => x.id));
            const unique = additions.filter(x => { if (known.has(x.id)) return false; known.add(x.id); return true; });
            const nextModel = C.normalize({...model, images: [...model.images, ...unique]});
            if (!setContent(C.serialize(nextModel))) throw new Error('插入被拒绝，图片仍在待恢复列表中。');
            model = nextModel;
            for (const [key] of entries) delete plugin.pending[key];
            await plugin.persistPending();
        } finally { unlockSave(); }
    };

    const view = {writable, recover, busy, dispose: null};
    if (!plugin.views.has(id)) plugin.views.set(id, new Set());
    plugin.views.get(id).add(view);

    root.addEventListener('paste', event => {
        if (event.target.closest('input,textarea,select') || !writable() || plugin.jobs.has(id) || !event.clipboardData) return;
        const input = plugin.readClipboard(event.clipboardData, doc);
        if (input.files.length || input.refs.length) {
            event.preventDefault(); event.stopPropagation();
            plugin.importImages(id, input);
        }
    }, {signal});
    root.addEventListener('dragover', event => {
        if (writable()) { event.preventDefault(); root.classList.add('sig-dragging'); }
    }, {signal});
    root.addEventListener('dragleave', event => {
        if (!root.contains(event.relatedTarget)) root.classList.remove('sig-dragging');
    }, {signal});
    root.addEventListener('drop', event => {
        root.classList.remove('sig-dragging');
        if (!writable() || plugin.jobs.has(id)) return;
        event.preventDefault(); event.stopPropagation();
        const input = plugin.readClipboard(event.dataTransfer, doc);
        if (input.files.length || input.refs.length) plugin.importImages(id, input);
    }, {signal});
    stage.addEventListener('scroll', () => {
        if (displayMode === 'row' && !restoreRow) { state.scroll = stage.scrollLeft; sync(); }
    }, {signal, passive: true});
    root.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.target.closest('input,textarea,select,dialog,.sig-panel,.sig-modes')) return;
        event.preventDefault();
        move(event.key === 'ArrowRight' ? 1 : -1);
    }, {signal});

    root.append(toolbar, picker, panel, stage, status);
    shadow.append(root);
    renderStage(); busy();

    const observer = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
    observer?.observe(root);
    if (!observer) win.addEventListener('resize', schedule, {signal});
    if (writable()) queueMicrotask(() => { if (!disposed) plugin.protect(id, model.images).catch(warn); });

    view.dispose = () => {
        if (disposed) return;
        if (displayMode === 'row' && !restoreRow) state.scroll = stage.scrollLeft;
        disposed = true;
        events.abort(); stageEvents.abort(); observer?.disconnect();
        win.cancelAnimationFrame(frame); clearTimeout(noticeTimer);
        for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
        plugin.views.get(id)?.delete(view);
        if (!plugin.views.get(id)?.size) plugin.views.delete(id);
    };
    return view.dispose;
};
