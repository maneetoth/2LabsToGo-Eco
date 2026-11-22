import "./globals.css";
import StoreProvider from "./StoreProvider";

export const metadata = { title: "Quant TLC" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body><StoreProvider>{children}</StoreProvider></body>
    </html>
  );
}
