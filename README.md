# Document Image Gallery · Inline Gallery

A simple gallery feature built on SiYuan custom blocks.

Type **`/gallery`** or **`/画廊`** in a normal document paragraph, select "Image Gallery" and press Enter. Keywords such as `图片画廊` and `hualang` are also supported, and the compact slash menu works as well.

## Image Import

| Input | Behavior |
| --- | --- |
| Multi-file selection, drag & drop, clipboard screenshots/files | Saved to the global workspace `/assets/` via `/api/asset/upload` |
| SiYuan image HTML, image Markdown, `assets/...` paths | Existing paths are reused; when the clipboard contains both a local link and a bitmap, the link is reused first |
| HTML Base64 images | Converted to image files and uploaded; not written into block JSON |
| Remote image URLs | Downloaded and uploaded when pasted or when clicking "Save to assets"; failure shows a notice |
| "Keep external link" | Explicitly keeps HTTP(S) links; offline access, upstream changes, and cross-device availability depend on the source site |

The plugin maintains a `custom-data-assets-gallery-*` block attribute for every local path, so that SiYuan's asset scan recognizes the images and they are not mistaken for "unreferenced items".
