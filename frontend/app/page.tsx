"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useStore } from "@/lib/store";
import Seal from "../components/Seal";
import Marquee from "../components/Marquee";
import RevealOnScroll from "../components/RevealOnScroll";
import StatCounter from "../components/StatCounter";
import TemplateIcon from "../components/TemplateIcon";

const failures = [
  {
    value: 40,
    suffix: "%",
    label: "of B2B payment delays",
    body: "are disputes over what was agreed — a Word doc said one thing, an invoice said another.",
  },
  {
    value: 0,
    suffix: "",
    label: "portable reputation",
    body: "A five-star rating on a marketplace is the marketplace's data. It doesn't survive a ban or a shutdown.",
  },
  {
    value: 1,
    suffix: "-sided",
    label: "clientflow tools",
    body: "The provider sends a contract and hopes. The client can ghost after work begins.",
  },
];

const feed = [
  { a: "harbor-studio.pact.eth", b: "north-supply.pact.eth", tpl: "Milestone", value: "$7,500", flag: "on time" },
  { a: "delta-labs.pact.eth", b: "unit-agency.pact.eth", tpl: "Retainer", value: "$2,000/mo", flag: "active" },
  { a: "forge-collective.pact.eth", b: "reef-client.pact.eth", tpl: "Split", value: "$10,000", flag: "atomic" },
  { a: "quiet-form.pact.eth", b: "atlas-co.pact.eth", tpl: "Fixed", value: "$3,200", flag: "on time" },
];

const heroCards = [
  { k: "pact:type", v: "milestone", rot: -4, top: "6%", left: "8%" },
  { k: "pact:amount", v: "$7,500 USDC", rot: 3, top: "34%", left: "46%" },
  { k: "pact:status", v: "verified ✓", rot: -2, top: "62%", left: "16%" },
];

const headline = ["Both parties commit.", "Both parties can verify.", "Neither can ghost."];

const fixes = [
  { title: "Verify before you sign", body: "Resolve the proposed terms live on ENS. What you see is what's going on-chain — no PDF, no 'our records show.'", icon: "fixed" as const },
  { title: "Backend-optional release", body: "releaseMilestone() is callable directly by the accepting party's wallet. If Pact's server disappears, your payment still releases.", icon: "milestone" as const },
  { title: "Reputation you keep", body: "Every completed engagement emits a PactCompleted event. Anyone can reproduce your track record from the block explorer.", icon: "retainer" as const },
  { title: "Atomic split delivery", body: "Two providers, one client, one transaction. Neither has to trust the other with the split.", icon: "split" as const },
];

export default function Landing() {
  const { currentBusiness } = useStore();
  const ctaHref = currentBusiness ? "/templates" : "/identity";

  return (
    <div>
      {/* HERO */}
      <section className="relative pt-16 pb-20 binding pl-6 -ml-6 overflow-hidden">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
          <div>
            <motion.div
              className="flex items-center gap-2 mb-6"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Seal size={30} />
              <p className="mono-tag text-ink-faint">Pact</p>
            </motion.div>

            <h1 className="font-serif text-[2.5rem] sm:text-[3.3rem] leading-[1.08] max-w-xl">
              {headline.map((line, i) => (
                <span key={line} className="block overflow-hidden">
                  <motion.span
                    className="block"
                    initial={{ y: "110%" }}
                    animate={{ y: "0%" }}
                    transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>

            <motion.p
              className="mt-5 text-lg text-ink-soft max-w-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.65 }}
            >
              Six contract templates. USDC escrow. Reputation that&rsquo;s
              yours, not ours.
            </motion.p>

            <motion.div
              className="mt-8 flex items-center gap-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8 }}
            >
              <Link href={ctaHref} className="btn-primary">
                Start an engagement
              </Link>
              <span className="text-sm text-ink-faint hidden sm:inline">
                No wallet connect. No chain selector. Email only.
              </span>
            </motion.div>
          </div>

          {/* Floating ENS record cards — decorative, hidden on small screens */}
          <div className="relative h-72 hidden lg:block">
            {heroCards.map((c, i) => (
              <motion.div
                key={c.k}
                className="absolute border border-rule bg-paper-bright px-4 py-3 shadow-none"
                style={{ top: c.top, left: c.left, rotate: c.rot }}
                initial={{ opacity: 0, y: 24 }}
                animate={{
                  opacity: 1,
                  y: [0, -8, 0],
                }}
                transition={{
                  opacity: { duration: 0.6, delay: 0.4 + i * 0.15 },
                  y: { duration: 4 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 },
                }}
              >
                <p className="mono-tag text-ink-faint">{c.k}</p>
                <p className="font-mono text-sm">{c.v}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* TICKER */}
      <RevealOnScroll>
        <section>
          <p className="text-sm text-ink-faint mb-3">The record, so far</p>
          <Marquee rows={feed} />
          <p className="text-xs text-ink-faint mt-3">
            Illustrative — every real event here is reproducible from the block
            explorer, not from Pact&rsquo;s database.
          </p>
        </section>
      </RevealOnScroll>

      {/* FAILURES */}
      <section className="py-14 border-t border-rule mt-14">
        <RevealOnScroll>
          <h2 className="font-serif text-2xl mb-8 max-w-lg">
            Two businesses want to work together. Right now, that&rsquo;s a
            Word doc and a hope.
          </h2>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-3 gap-px bg-rule">
          {failures.map((f, i) => (
            <RevealOnScroll key={f.label} delay={i * 0.1} className="bg-paper-bright p-6">
              <p className="font-serif text-3xl mb-2">
                <StatCounter value={f.value} suffix={f.suffix} />
              </p>
              <p className="text-sm mb-3">{f.label}</p>
              <p className="text-sm text-ink-soft">{f.body}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* FIXES */}
      <section className="py-14 border-t border-rule">
        <RevealOnScroll>
          <h2 className="font-serif text-2xl mb-3">How Pact fixes it</h2>
          <p className="text-ink-soft max-w-xl mb-8">
            Terms live on ENS — readable by anyone, disputable by nobody. Both
            parties escrow USDC before work begins. Completion emits an
            on-chain event that becomes permanent, portable reputation.
          </p>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-2 gap-6">
          {fixes.map((f, i) => (
            <RevealOnScroll key={f.title} delay={i * 0.08}>
              <motion.div
                className="border border-rule p-5 bg-paper-bright h-full"
                whileHover={{ y: -3, borderColor: "#161A1E" }}
                transition={{ duration: 0.15 }}
              >
                <div className="w-9 h-9 flex items-center justify-center border border-rule mb-3 text-stamp">
                  <TemplateIcon id={f.icon} size={20} />
                </div>
                <p className="mb-2">{f.title}</p>
                <p className="text-sm text-ink-soft">{f.body}</p>
              </motion.div>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* CLOSING */}
      <section className="py-16 border-t border-rule text-center">
        <RevealOnScroll>
          <Seal size={36} className="mx-auto mb-6" tone="stamp" />
          <p className="font-serif text-xl italic mb-6 max-w-md mx-auto">
            &ldquo;Your contract is an ENS name. Your reputation is an event
            log. Neither belongs to us.&rdquo;
          </p>
          <Link href={ctaHref} className="btn-primary">
            Start an engagement
          </Link>
        </RevealOnScroll>
      </section>
    </div>
  );
}
