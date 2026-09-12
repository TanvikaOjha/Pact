"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import Seal from "./Seal";

export default function Nav() {
  const { currentBusiness } = useStore();
  const pathname = usePathname();

  const links = [
    { href: "/templates", label: "Engagements" },
    { href: currentBusiness ? `/profile/${currentBusiness.slug}` : "/identity", label: "Profile" },
  ];

  return (
    <header className="border-b border-rule bg-paper-bright/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 group">
          <Seal size={26} />
          <span className="font-serif text-xl tracking-tight group-hover:text-stamp transition-colors">
            Pact
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`relative hover:text-stamp transition-colors ${
                pathname === l.href ? "text-stamp" : "text-ink-soft"
              }`}
            >
              {l.label}
              {pathname === l.href && (
                <span className="absolute -bottom-1.5 left-0 right-0 h-[1.5px] bg-stamp" />
              )}
            </Link>
          ))}
          {currentBusiness ? (
            <span className="mono-tag border border-rule px-2 py-1 bg-paper-dim">
              {currentBusiness.ensSubname}
            </span>
          ) : (
            <Link href="/identity" className="btn-primary text-sm px-4 py-2">
              Get started
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
