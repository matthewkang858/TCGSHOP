import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Countertop",
  description: "Repricing and price alerts for local game stores",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
