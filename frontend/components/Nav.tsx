"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadSubnameFor } from "@/lib/utils";
import Seal from "./Seal";
import { truncateMid } from "@/lib/utils";

export default function Nav() {
  const { walletAddress, ready, signOut } = useAuth();
  const pathname = usePathname();
  const [subname, setSubname] = useState<string | null>(null);

  useEffect(() => {
    setSubname(walletAddress ? loadSubnameFor(walletAddress) : null);
  }, [walletAddress, pathname]);

  const links = [
    { href: "/templates", label: "Engagements" },
    { href: "/identity", label: "Identity" },
  ];

  return (
    <header className="border-b border-line bg-canvas/90 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 group">
          <Seal size={26} />
          <span className="text-xl tracking-tight group-hover:text-accent transition-colors">
            Pact
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded px-3 py-1.5 font-medium transition-colors ${
                pathname === l.href ? "text-accent" : "text-ink-body hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
          {!ready ? null : walletAddress ? (
            <span className="flex items-center gap-2 ml-2">
              <span className="mono-tag border border-line rounded px-2 py-1 bg-canvas-soft text-ink-body">
                {subname ?? truncateMid(walletAddress)}
              </span>
              <button
                onClick={signOut}
                className="text-xs text-ink-mute hover:text-ink transition-colors"
              >
                Sign out
              </button>
            </span>
          ) : (
            <Link href="/identity" className="btn-primary text-sm ml-2">
              Get started
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
