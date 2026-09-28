import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SO-101 XR Teleoperation",
  description: "Zapbox / WebXR operator for an SO-101 follower arm",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
