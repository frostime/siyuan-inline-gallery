/* Renders assets/icon.svg to the 160x160 icon.png the marketplace accepts: it
 * rejects SVG icons, and caps the raster at 64 KiB. Dev tool only — the committed
 * PNG is what ships, so the package build and CI need no browser. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), launch = require('../tests/launch.cjs');

const SIZE = 160, LIMIT = 64 * 1024;

(async () => {
    const root = path.resolve(__dirname, '..');
    const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
    const target = path.join(root, 'icon.png');
    const browser = await launch();
    try {
        const page = await browser.newPage({viewport: {width: SIZE, height: SIZE}, deviceScaleFactor: 1});
        await page.setContent('<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>' + svg);
        await page.locator('svg').screenshot({path: target, omitBackground: true});
    } finally { await browser.close(); }
    const size = fs.statSync(target).size;
    if (size > LIMIT) throw new Error(`icon.png is ${size} bytes; the marketplace limit is ${LIMIT}`);
    console.log(`icon.png ${SIZE}x${SIZE}, ${size} bytes`);
})().catch(error => { console.error(error.message); process.exit(1); });
