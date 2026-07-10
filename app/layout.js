import "../styles.css";

export const metadata = {
  title: "别墅大型沙发生图",
  description: "别墅、大平层、豪宅客厅大型沙发空间效果图生成工具",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
