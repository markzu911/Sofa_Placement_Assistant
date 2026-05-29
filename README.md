# 沙发摆放助手

Vercel 版本的 Gemini 沙发场景融合工具。产品图必传，后端会把产品图作为不可变参考，尽量保持沙发款式、颜色、轮廓、材质、坐垫、扶手、脚架等细节不变。

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

然后直接导入这个目录或连接 Git 仓库部署。项目不需要 Python，也不需要额外构建步骤。

## 功能

- 沙发产品图必传，用于锁定原产品样式。
- 选择场景风格，可选上传房间风格参考图；参考图只用于色调、材质、光线和软装气质，不还原原房间。
- 4 种视角：远景图、中近景、近景、模特。
- 2K / 4K、图片比例选择。
- 单张生成、预览、下载。
