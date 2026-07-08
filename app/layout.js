import "../styles.css";

export const metadata = {
  title: "产品摆放助手",
  description: "AI 产品摆放效果图生成工具",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
