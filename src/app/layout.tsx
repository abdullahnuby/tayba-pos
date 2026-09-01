import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "@/components/providers";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "طيبة — نظام إدارة المحلات",
  description: "طيبة — نظام نقطة بيع وإدارة محلات ملابس متكامل: مبيعات، مشتريات، مخزون، تقارير، ومزامنة Google Sheets",
  keywords: ["طيبة", "Tayba", "POS", "نقطة بيع", "إدارة محلات", "ملابس", "تجزئة"],
  authors: [{ name: "Tayba POS" }],
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${cairo.variable} font-cairo antialiased bg-background text-foreground`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            {children}
            <Toaster />
            <SonnerToaster position="top-center" richColors />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
