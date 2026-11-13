import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clay",
  description: "Explore a decision on live web data, then keep it live as the web changes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
