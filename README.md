# 家具摆放助手

Vercel 版本的 Gemini 家具场景融合工具。产品图必传，后端会把产品图作为不可变参考，尽量保持家具款式、颜色、轮廓、材质、坐垫、扶手、脚架等细节不变。

## 本地运行

先复制配置：

```bash
cp .env.example .env
```

在 `.env` 填入：

```env
GEMINI_API_KEY=你的 Gemini API Key
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
PORT=8002
HOST=0.0.0.0
```

如果后面想改走 Vercel AI Gateway，再额外配置：

```env
GEMINI_PROVIDER=vercel-ai-gateway
AI_GATEWAY_API_KEY=你的 Vercel AI Gateway Key
AI_GATEWAY_IMAGE_MODEL=google/gemini-3-pro-image
```

启动：

```bash
npm run dev
```

本机打开 `http://127.0.0.1:8002`。同一局域网设备可打开本机网络地址，例如 `http://192.168.50.70:8002`。

如果只想允许本机访问，把 `HOST` 改成 `127.0.0.1`。

## 部署到 Vercel

在 Vercel 项目的 Environment Variables 里添加：

```env
GEMINI_API_KEY=你的 Gemini API Key
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
```

然后直接导入这个目录或连接 Git 仓库部署。项目不需要 Python，也不需要额外构建步骤。Vercel 项目设置里 Framework Preset 选 `Next.js`，Output Directory 留空。

## SaaS 接入流程

- 页面会从 SaaS `postMessage` 的 `SAAS_INIT` 或 URL 参数读取 `userId/toolId`，不需要在 Vercel 里额外配置工具 ID。
- 用户上传产品图或调整风格后，前端会先调用 `/api/analyze` 做 AI 摆位分析，判断产品体量、适配空间、空间线索、光线、动线和远/中/近景延展方式。
- `/api/generate` 会先调用 SaaS `/api/tool/verify` 校验积分。
- `/api/generate` 会复用前置分析；如果分析缺失或过期，生成前会重新分析一次，再把分析结果写入生图提示词。
- Gemini 生成失败不会扣费，也不会上传任何图片。
- AI 最终结果图生成成功后，后端调用 `/api/tool/consume` 扣费。
- 扣费成功后，后端调用 `/api/upload/direct-token` 获取短期 OSS 上传地址。
- 后端把最终结果图二进制 `PUT` 到 OSS，再调用 `/api/upload/commit` 入库。
- 前端收到 `recordId/url/fileName/fileSize`，并用返回的 `url` 预览图片。
- 用户上传的产品图和房间参考图只传给 Gemini，不写入 SaaS OSS，也不进入“我的图片”。

## 功能

- 家具产品图必传，用于锁定原产品样式。
- 上传后先进行 AI 摆位分析，再根据分析结果生成画面；不会固定套用某几个预设落点。
- 选择场景风格，可选上传房间风格参考图；参考图只用于色调、材质、光线和软装气质，不还原原房间。
- 3 种摄影景别：远景、中景、近景；模特可独立选择是否添加。
- 2K / 4K、图片比例选择。
- 单张生成、预览、下载；接入 SaaS 后生成结果会保存到“我的图片”。
