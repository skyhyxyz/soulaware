import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoulAware",
  description:
    "SoulAware is an AI life guidance coach for purpose mapping, reflection, and practical next steps.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
