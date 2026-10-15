import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

// The studio's one typeface. Fetched from Google Fonts when the app is built
// and served with it, so every computer shows it — nothing to install.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CONVERSATION GENERATOR",
  description: "Prototype voice agents for flow-diagram playbooks.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
