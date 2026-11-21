# 实现说明

## 数据

画廊是原生 `siyuan-inline-gallery/gallery` custom block。所有持久化画廊数据保存在 JSON content 中；临时 DOM 仅显示内容。插件不会改写普通图片节点或接管文档全局粘贴。

```text
;;;siyuan-inline-gallery/gallery
{"version":2,"layout":"focus","size":1,"gap":16,"captions":false,"images":[{"id":"example","src":"assets/photo-id.jpg","alt":"说明","name":"photo.jpg","width":1200,"height":800}]}
;;;
```

`layout` 为新画廊默认的 `focus`（主图）或 `row`（横排）；v1 数据没有主图视图，迁移时统一落到 `row`。

## 宿主约定

- `customBlockRenders.gallery.render({element,content,setContent})` 注册 renderer，返回 dispose。
- `protyleSlash` 注册 `/gallery`、`/画廊` 和拼音关键词，包括精简版。
- 插入入口仅 `protyleSlash`，使用其公开 Protyle 回调；不注册面包屑按钮、命令面板或额外快捷键。
- 插入调用宿主 `Md2BlockDOM` 和 `insert(...,true)`；保存仅在 render 返回后的交互中用 setContent，不嵌套 Protyle。
- renderer 在 mount 下创建一个 open ShadowRoot，所有组件 DOM、样式、图标和对话框都在内部；宿主/主题的全局 SVG、图片和按钮规则不能直接匹配内部节点，主题 CSS 变量仍通过宿主继承。组件 CSS 从 src/gallery.css 生成 styles.js 并内联进 index.js，避免宿主样式顺序影响。资源属性经内核 API 写入。插件不使用 Node fs 操作工作空间。

## 资源与恢复

逐张调用 `/api/asset/upload`，统一 `/assets/`，优先取 succFiles，兼容 succMap；上传名称唯一化，处理同名文件。新图片的原始文件名存入 name，说明 alt 默认空，不用文件名充当展示说明。

每个本地路径独立写入 `custom-data-assets-gallery-<UTF8 hex>` 属性，值为完整路径。属性名可逆且无短哈希碰撞；空间代价较大，适合小中型画廊。保存内容前维护属性，加载原始数据时也补齐引用。累计保留旧属性以保护撤销/历史；不主动删除文件。

上传成功后先存 pending.json，再保护引用，最后合并当前 block content。批次按图片 ID 去重；宿主拒绝写入或原编辑器关闭时保留恢复记录。多接口间不具备原子事务，不能保证掉电零丢失或跨窗口强一致。

## 预览与复制

预览浮层是 ShadowRoot 内的 `<dialog>`，负责缩放、翻页和「复制图片」。复制用浏览器剪贴板 API：先 `fetch` 当前图片，不是 PNG 时经 blob URL 解码到 canvas 再编码为 PNG——Chromium 的剪贴板写入只接受 `image/png`；blob URL 让 canvas 保持同源，SVG 也能转换。因此不带 CORS 头的外链会失败并提示先下载到 assets。复制只读，不改写块内容，只读与发布模式下可用。

复制进行中不禁用按钮：禁用的元素会失去焦点，浮层的左右方向键随即失效；改用内部标志阻止重入。

三类失败各自给一句可执行提示，因为浏览器原文不含下一步：跨域 `fetch` 失败是 `TypeError`，图片无法解码是 `DOMException` 的 `EncodingError`，剪贴板拒绝写入是 `NotAllowedError`。实测（Chromium 1248）剪贴板写入要求剪贴板权限，而不是点击后的时效窗口：授权后等待 5.5 秒再写入仍然成功，未授权时立即写入也失败。

## 官方参考

于 2026-11-13 查阅；分支可能继续变化。类型对照 siyuan@1.2.9。

- [plugin-sample](https://github.com/siyuan-note/plugin-sample)
- [plugin-sample/src/index.ts](https://github.com/siyuan-note/plugin-sample/blob/main/src/index.ts)
- [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte)
- [其 custom block 与 slash 示例](https://github.com/siyuan-note/plugin-sample-vite-svelte/blob/main/src/index.ts)
- [其 CommonJS 打包](https://github.com/siyuan-note/plugin-sample-vite-svelte/blob/main/vite.config.ts)
- [宿主 renderer](https://github.com/siyuan-note/siyuan/blob/master/app/src/plugin/customBlockRender.ts)
- [宿主 loader](https://github.com/siyuan-note/siyuan/blob/master/app/src/plugin/loader.ts)
- [内核资源扫描](https://github.com/siyuan-note/siyuan/blob/master/kernel/model/assets.go)
- [官方 API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)
- [Custom block 文件格式](https://github.com/siyuan-note/siyuan/blob/master/docs/SY-FORMAT.md)
