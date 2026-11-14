/* Inline Gallery — CommonJS entry, intentionally externalizes SiYuan's SDK.
 * Only the custom renderer mount is modified. All workspace writes use kernel APIs.
 */
'use strict';

const {Plugin, showMessage} = require('siyuan');
const C = require('./core.js');
const renderGallery = require('./renderer.js');

const TYPE = 'gallery';
// Uploadable image formats; EXT covers files whose MIME type the OS did not report.
const MIME = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|tiff|heic|heif))$/i;
const EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|tiff?|heic|heif)$/i;
const MAX_BYTES = 50 * 1024 * 1024;
// Base64 inflates by ~4/3; compare the raw byte budget against data-URL length.
const MAX_DATAURL_CHARS = MAX_BYTES * 1.4;
const UPLOAD_TIMEOUT_MS = 60000;
const DOWNLOAD_TIMEOUT_MS = 30000;

module.exports = class InlineGallery extends Plugin {
    async onload() {
        this.stopped = false;
        this.views = new Map(); this.jobs = new Map(); this.ui = new Map(); this.pending = {};
        this.network = new AbortController();
        this.saveChain = Promise.resolve();
        await this.restorePending();
        if (this.stopped) return;
        this.customBlockRenders[TYPE] = {render: options => this.renderGallery(options)};
        if (isReadonly()) return;
        const insert = protyle => {
            if (!protyle || protyle.disabled || protyle.protyle?.disabled || isReadonly()) return;
            const info = `${encodeURIComponent(this.name)}/${TYPE}`;
            const markdown = `;;;${info}\n${C.serialize(C.DEFAULTS)}\n;;;\n\n`;
            // Same insertion path as plugin-sample's custom block example.
            const lute = protyle.protyle?.lute;
            if (!lute || !protyle.insert) { notify('请在可编辑的文档中插入画廊。'); return; }
            protyle.insert(lute.Md2BlockDOM(markdown), true);
        };
        this.protyleSlash = [{
            id: 'insert-inline-gallery',
            filter: ['gallery', 'image gallery', '图片画廊', '画廊', '图库', 'hualang', 'tupianhualang', 'hl'],
            html: '<div class="b3-list-item__first"><span class="b3-list-item__text">图片画廊</span></div>',
            showInLite: true,
            // The slash menu is the sole insertion entry.
            callback: insert,
        }];
    }

    // Reload failed recovery entries from the last session. Invalid entries are
    // skipped so one corrupt record cannot disable the whole recovery queue.
    async restorePending() {
        try {
            const saved = await this.loadData('pending.json');
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
            for (const [key, batch] of Object.entries(saved)) {
                // batch.blockId must look like a SiYuan node id (yyyymmddhhmmss-xxxxxxx).
                if (!batch || !/^\d{14}-[a-z0-9]{7}$/.test(batch.blockId)) continue;
                try {
                    this.pending[key] = {blockId: batch.blockId, images: C.normalize({...C.DEFAULTS, images: batch.images}).images};
                } catch { /* ignore invalid recovery entries */ }
            }
        } catch { /* first use: no pending.json yet */ }
    }

    async api(path, body, signal = this.network.signal) {
        if (this.stopped) throw new Error('插件已停用');
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) controller.abort();
        const timeout = setTimeout(abort, UPLOAD_TIMEOUT_MS);
        try {
            const isForm = body instanceof FormData;
            const response = await fetch(path, {
                method: 'POST',
                body: isForm ? body : JSON.stringify(body),
                headers: isForm ? undefined : {'Content-Type': 'application/json'},
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
            const result = await response.json();
            if (result.code !== 0) throw new Error(result.msg || '思源 API 返回错误');
            return result.data;
        } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    }

    // Keep the local asset references of a block visible to SiYuan's asset scan.
    async protect(blockId, images) {
        if (!blockId || this.stopped || isReadonly()) throw new Error('无法维护当前块的资源引用');
        if (!images.some(image => image.src.startsWith('assets/'))) return;
        const attrs = {};
        const known = await this.api('/api/attr/getBlockAttrs', {id: blockId});
        for (const image of images) if (image.src.startsWith('assets/')) {
            // One full path per attribute avoids ambiguous lists with spaces/commas.
            // Collision-free UTF-8 hex keys, unlike a short non-cryptographic hash.
            const hexKey = Array.from(new TextEncoder().encode(image.src), b => b.toString(16).padStart(2, '0')).join('');
            const name = 'custom-data-assets-gallery-' + hexKey;
            if (known?.[name] !== image.src) attrs[name] = image.src;
        }
        if (Object.keys(attrs).length) {
            await this.api('/api/attr/setBlockAttrs', {id: blockId, attrs});
        }
    }

    persistPending() {
        const snapshot = JSON.parse(JSON.stringify(this.pending));
        this.saveChain = this.saveChain.catch(() => {}).then(() => this.saveData('pending.json', snapshot));
        return this.saveChain;
    }

    refreshBusy(id) { for (const view of this.views.get(id) || []) view.busy(this.jobs.has(id)); }

    async upload(file, index) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name}：单张图片不能超过 50 MiB`);
        if (!validFile(file)) throw new Error(`${file.name}：不支持的图片格式`);
        const form = new FormData();
        const name = nameFor(file, index);
        form.append('assetsDirPath', '/assets/');
        form.append('file[]', file, name);
        const size = await dimensions(file);
        const data = await this.api('/api/asset/upload', form);
        // Newer kernels return succFiles; older ones only succMap keyed by upload name.
        const returnedPath = data?.succFiles?.find(x => x.index === 0)?.path || data?.succMap?.[name];
        const src = C.source(returnedPath);
        if (!src || !src.startsWith('assets/')) throw new Error(`${file.name}：上传未返回有效的 assets 路径`);
        return {id: C.uid(), src, alt: '', name: file.name || '', ...size};
    }

    async remote(ref, index) {
        const isDataUrl = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,/i.test(ref.src);
        if (!isDataUrl && !C.source(ref.src)) throw new Error('不支持的图片地址');
        if (isDataUrl && ref.src.length > MAX_DATAURL_CHARS) throw new Error('粘贴图片超过大小限制');
        const controller = new AbortController();
        const abort = () => controller.abort();
        this.network.signal.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(abort, DOWNLOAD_TIMEOUT_MS);
        try {
            const response = await fetch(ref.src, {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const contentLength = Number(response.headers.get('content-length'));
            if (contentLength > MAX_BYTES) throw new Error('图片超过 50 MiB');
            const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (!MIME.test(type)) throw new Error('地址未返回受支持的图片类型');
            let blob;
            if (response.body?.getReader) {
                // Stream so an oversized download aborts mid-transfer instead of
                // buffering the whole body before the size check.
                const reader = response.body.getReader();
                const chunks = [];
                let total = 0;
                try {
                    while (true) {
                        const {done, value} = await reader.read();
                        if (done) break;
                        total += value.byteLength;
                        if (total > MAX_BYTES) { await reader.cancel(); throw new Error('图片超过 50 MiB'); }
                        chunks.push(value);
                    }
                    blob = new Blob(chunks, {type});
                } finally { reader.releaseLock(); }
            } else {
                blob = await response.blob();
            }
            if (blob.size > MAX_BYTES || !MIME.test(blob.type)) throw new Error('地址未返回受支持的图片，或图片超过 50 MiB');
            const suffix = {'image/jpeg': 'jpg', 'image/svg+xml': 'svg'}[blob.type] || blob.type.split('/')[1];
            const file = new File([blob], `image.${suffix}`, {type: blob.type});
            const image = await this.upload(file, index);
            image.alt = ref.alt || '';
            return image;
        } catch (error) {
            throw new Error(`网络图片保存失败：${errorText(error)}。可下载后拖入，或使用“保留外链”明确保留外链。`);
        } finally { clearTimeout(timer); this.network.signal.removeEventListener('abort', abort); }
    }

    async importImages(id, input, keepRemote = false) {
        if (this.jobs.has(id) || this.stopped || isReadonly()) return;
        this.jobs.set(id, true);
        this.refreshBusy(id);
        const batchId = C.uid();
        const images = [];
        const failures = [];
        try {
            const tasks = [...input.files.map(file => ({file})), ...input.refs.map(ref => ({ref}))];
            for (let index = 0; index < tasks.length && !this.stopped; index++) {
                const task = tasks[index];
                let image;
                try {
                    if (task.file) {
                        image = await this.upload(task.file, index);
                    } else {
                        const src = C.source(task.ref.src);
                        image = src?.startsWith('assets/') || (keepRemote && src)
                            ? {id: C.uid(), src, alt: task.ref.alt || '', width: 0, height: 0}
                            : await this.remote(task.ref, index);
                    }
                    if (this.stopped) break;
                    // Save recovery information before attempting editor commit.
                    images.push(image);
                    this.pending[batchId] = {blockId: id, images: [...images]};
                    await this.persistPending();
                    await this.protect(id, [image]);
                } catch (error) {
                    failures.push(errorText(error));
                    if (this.stopped) break;
                }
            }
            if (this.stopped) return;
            if (images.length) {
                // A host re-render can dispose the originating mount while uploading.
                // Resolve a live mount now, then merge with its current content.
                const view = Array.from(this.views.get(id) || []).find(v => v.writable());
                if (view) await view.recover(batchId);
                else notify('图片已保存；重新打开原画廊后点击“恢复待插入”。', 8000);
            }
            if (failures.length) notify(failures.join('\n'), 10000, 'error');
        } catch (error) {
            if (!this.stopped) notify('导入未完成：' + errorText(error) + '。已上传图片可通过“恢复待插入”重试。', 10000, 'error');
        } finally { this.jobs.delete(id); this.refreshBusy(id); }
    }

    readClipboard(data, doc) { return clipboardInput(data, doc); }

    renderGallery(options) { return renderGallery(this, options); }

    onunload() {
        if (this.stopped) return;
        this.stopped = true;
        this.network?.abort();
        for (const views of Array.from(this.views?.values() || [])) {
            for (const view of Array.from(views)) view.dispose?.();
        }
        this.views?.clear(); this.jobs?.clear(); this.ui?.clear();
        // Recovery data is persisted per upload, not deferred to teardown.
    }
};

// ── Module-local helpers ────────────────────────────────────────────────────
// Hoisted function declarations; the class above is the module's entry point.

function errorText(error) { return error?.message || String(error); }

function notify(message, timeout = 7000, type) {
    // SiYuan messages accept HTML; filenames and server errors must stay text.
    const safe = String(message)
        .replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]))
        .replace(/\n/g, '<br>');
    showMessage(safe, timeout, type);
}

function isReadonly(element) {
    return !!(window.siyuan?.config?.readonly || window.siyuan?.isPublish ||
        element?.closest('.protyle-wysiwyg')?.getAttribute('contenteditable') === 'false');
}

function validFile(file) {
    return !!file && (MIME.test(file.type.split(';')[0]) || (!file.type && EXT.test(file.name)));
}

function nameFor(file, index) {
    const original = String(file.name || 'pasted-image.png').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100);
    // Different upload names also work with older kernels returning only succMap.
    return `gallery-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}-${original}`;
}

async function dimensions(file) {
    const url = URL.createObjectURL(file);
    try {
        return await new Promise(resolve => {
            const img = new Image();
            const finish = value => { clearTimeout(timer); img.onload = img.onerror = null; resolve(value); };
            // Unreadable dimensions must not block an upload; 0 falls back to ratio 1.5.
            const timer = setTimeout(() => finish({width: 0, height: 0}), 5000);
            img.onload = () => finish({width: img.naturalWidth, height: img.naturalHeight});
            img.onerror = () => finish({width: 0, height: 0});
            img.src = url;
        });
    } finally { URL.revokeObjectURL(url); }
}

function clipboardInput(data, doc) {
    const files = Array.from(data.files || []).filter(validFile);
    if (!files.length && data.items) {
        for (const item of Array.from(data.items)) {
            if (item.kind !== 'file') continue;
            const file = item.getAsFile();
            if (validFile(file)) files.push(file);
        }
    }
    const refs = [];
    const html = data.getData('text/html');
    if (html) {
        const parsed = new doc.defaultView.DOMParser().parseFromString(html, 'text/html');
        for (const img of parsed.querySelectorAll('img')) {
            let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
            // Same-origin /assets/... URLs reduce to plain workspace paths.
            try {
                const url = new URL(src, doc.location.href);
                if (url.origin === doc.location.origin && url.pathname.startsWith('/assets/')) {
                    src = url.pathname.slice(1) + url.search + url.hash;
                }
            } catch { /* malformed src: keep as-is and let source() reject it */ }
            // Data URLs are converted to File objects by the importer, never persisted.
            if (C.source(src) || /^data:image\//i.test(src)) refs.push({src, alt: img.getAttribute('alt') || ''});
        }
    }
    const text = data.getData('text/plain') || data.getData('text/uri-list') || '';
    if (!refs.length) refs.push(...C.textImages(text));
    // Copying a SiYuan image often includes both a local link and a bitmap.
    if (refs.some(x => C.source(x.src)?.startsWith('assets/'))) return {files: [], refs};
    if (files.length) return {files, refs: []};
    return {files: [], refs};
}
