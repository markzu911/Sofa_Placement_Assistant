# 产品摆放助手

Vercel 版本的 Gemini 产品/家具场景融合工具。产品图必传，后端会先分析产品特征、房间风格或自定义房间，再按真实室内摄影的远景、中景、近景生成房间效果图。

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

本机打开 `http://127.0.0.1:8002`。本地测试不需要 SaaS `userId/toolId`，可以直接上传产品图、AI 分析并生成图片；本地生成不会扣费，也不会保存到“我的图片”。同一局域网设备可打开本机网络地址，例如 `http://192.168.50.70:8002`。

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
- 用户上传产品图或调整风格后，需要先点击“AI 分析”；前端调用 `/api/analyze` 做摆位分析，并在页面输出可编辑的结构化分析结果。
- AI 对话生图会调用 `/api/chat` 解析用户意图，输出可执行的参数更新、分析或生成动作；真正生图仍复用 `/api/analyze` 和 `/api/generate`。
- `/api/generate` 会先调用 SaaS `/api/tool/verify` 校验积分。
- 只有当前分析结果有效时，“生成图片”才可点击；`/api/generate` 会复用前置分析，并把分析结果写入生图提示词。
- Gemini 生成失败不会扣费，也不会上传任何图片。
- AI 最终结果图生成成功后，后端调用 `/api/tool/consume` 扣费。
- 扣费成功后，后端调用 `/api/upload/direct-token` 获取短期 OSS 上传地址。
- 后端把最终结果图二进制 `PUT` 到 OSS，再调用 `/api/upload/commit` 入库。
- 前端收到 `recordId/url/fileName/fileSize`，并用返回的 `url` 预览图片。
- 用户上传的产品图和房间参考图只传给 Gemini，不写入 SaaS OSS，也不进入“我的图片”。

## 功能

- 产品图必传，用于锁定原产品样式、比例、颜色、材质和主要识别细节。
- 上传后先输出 AI 摆位分析结果，支持人工修改分析内容，再根据最终分析结果生成画面；不会固定套用某几个预设落点。
- 选择普通场景风格时，房间/场景参考图只用于色调、材质、光线和软装气质。
- 选择自定义房间时，上传图会作为原始房间场景，生成时保持原房间身份，可做合理摄影级微整理；会先分析产品应该放在房间哪个位置，再锁定唯一主落位。
- 产品样式优先级最高，要求尽量 100% 还原原产品款式、颜色、材质、结构和细节；允许按房间比例等比例缩放到合理大小。
- 3 种摄影景别：远景、中景、近景；景别只改变拍摄距离、镜头焦距、相机高度和轻微角度，不改变产品主落位、朝向逻辑和地面接触点。
- AI 对话生图：支持用自然语言修改风格、画幅、景别、拍摄角度或直接触发生成；对话补充只影响摄影表达和环境氛围，不覆盖产品 100% 还原与落位锁定。
- 2K / 4K、图片比例选择。
- 单张生成、预览、下载；接入 SaaS 后生成结果会保存到“我的图片”。
