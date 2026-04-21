import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { cn } from "@/lib/utils";

const fontBody = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

const fontDisplay = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: "AlmaTrace",
  description: "Alumni Tracing & Intelligence Dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={cn(fontBody.variable, fontDisplay.variable, "min-h-screen font-body")}>
        {children}
        <Toaster position="top-right" theme="dark" richColors />
      </body>
    </html>
  );
}
