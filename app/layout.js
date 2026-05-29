import "../styles.css";

export const metadata = {
  title: "家具摆放助手",
  description: "AI 家具摆放效果图生成工具",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
