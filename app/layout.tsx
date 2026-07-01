import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Layout Thrashing Lab",
  description:
    "An interactive lab for forced synchronous layout, reflow, and rendering performance. Toggle jank on and watch the frame budget blow.",
};

type Props = Readonly<{
  children: React.ReactNode;
}>;

// Next.js requires the root layout to be this file's default export — the one
// place a default export is correct in this project.
const RootLayout = ({ children }: Props) => {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
