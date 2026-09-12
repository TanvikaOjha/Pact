import type { Metadata } from "next";
import { DM_Mono, Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import Nav from "@/components/Nav";
import Toaster, { ToastProvider } from "@/components/Toaster";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-dm-mono",
  weight: ["400"],
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  weight: ["400"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Pact — mutual B2B engagement, on-chain",
  description:
    "Propose, commit, deliver, get paid — with reputation that's yours forever.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${dmMono.variable} ${instrument.variable} font-sans text-ink bg-canvas`}
      >
        <AuthProvider>
          <ToastProvider>
            <Nav />
            <main className="max-w-5xl mx-auto px-6 pb-24">{children}</main>
            <footer className="border-t border-line">
              <div className="max-w-5xl mx-auto px-6 py-10 flex flex-wrap gap-x-8 gap-y-2 text-sm text-ink-mute">
                <span className="font-mono text-xs uppercase tracking-wider">Pact</span>
                <span>Your contract is an ENS name. Your reputation is an event log.</span>
                <span className="ml-auto font-mono text-xs">sepolia · usdc · ensv2</span>
              </div>
            </footer>
            <Toaster />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
