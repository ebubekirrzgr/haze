import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session.tsx";

export const metadata: Metadata = {
  title: "HAZE — Satmadan harca",
  description: "Birikimin getiri üretirken kartın limitini oluşturur. Stellar üzerinde.",
  manifest: "/manifest.json",
  icons: { icon: "/logo/haze-ikon-altin.svg", apple: "/logo/haze-ikon-altin.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "HAZE" },
};
export const viewport: Viewport = { themeColor: "#F3EBDC", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
