"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import Seal from "@/components/Seal";
import Marquee from "@/components/Marquee";
import RevealOnScroll from "@/components/RevealOnScroll";
import StatCounter from "@/components/StatCounter";
import TemplateIcon from "@/components/TemplateIcon";

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
  { a: "harbor-studio.pact-hack.eth", b: "north-supply.pact-hack.eth", tpl: "Milestone", value: "$7,500", flag: "on time" },
  { a: "delta-labs.pact-hack.eth", b: "unit-agency.pact-hack.eth", tpl: "Retainer", value: "$2,000/mo", flag: "active" },
  { a: "forge-collective.pact-hack.eth", b: "reef-client.pact-hack.eth", tpl: "Split", value: "$10,000", flag: "atomic" },
  { a: "quiet-form.pact-hack.eth", b: "atlas-co.pact-hack.eth", tpl: "Fixed", value: "$3,200", flag: "on time" },
];

const fixes = [
  { title: "Verify before you sign", body: "Resolve the proposed terms live on ENS. What you see is what's going on-chain — no PDF, no 'our records show.'", icon: "fixed" as const },
  { title: "Backend-optional release", body: "releaseMilestone() is callable directly by the accepting party's wallet. If Pact's server disappears, your payment still releases.", icon: "milestone" as const },
  { title: "Reputation you keep", body: "Every completed engagement emits a PactCompleted event. Anyone can reproduce your track record from the block explorer.", icon: "retainer" as const },
  { title: "Atomic split delivery", body: "Two providers, one client, one transaction. Neither has to trust the other with the split.", icon: "split" as const },
];

export default function Landing() {
  const { walletAddress } = useAuth();
  const ctaHref = walletAddress ? "/templates" : "/identity";

  return (
    <div>
      {/* HERO */}
      <section className="py-24">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <motion.div
              className="flex items-center gap-2 mb-6"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Seal size={30} />
              <p className="mono-tag text-ink-mute">Pact</p>
            </motion.div>

            <h1 className="text-[64px] leading-[1.1] tracking-[-1.6px] font-normal max-w-xl">
              <span className="block">
                <motion.span
                  className="block"
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 0.7, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  Both parties commit.
                </motion.span>
              </span>
              <span className="block overflow-hidden">
                <motion.span
                  className="block"
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 0.7, delay: 0.27, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  Both parties can verify.
                </motion.span>
              </span>
              <span className="block overflow-hidden">
                <motion.span
                  className="block"
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{ duration: 0.7, delay: 0.39, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  Neither can ghost.
                </motion.span>
              </span>
            </h1>

            <motion.p
              className="mt-5 text-lg text-ink-body max-w-lg"
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
              <span className="text-sm text-ink-mute hidden sm:inline">
                Email only. No seed phrase. No gas prompt.
              </span>
            </motion.div>
          </div>

          {/* Terminal mockup split — the brand's one decorative system */}
          <div className="grid gap-4">
            <motion.div
              className="terminal"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
                <span className="mono-tag text-ink-mute">propose — eng-a3f9.pact.eth</span>
              </div>
              <div className="px-4 py-3 space-y-1.5 font-mono text-[13px] leading-[18px]">
                <p><span className="text-ink-mute">pact:type&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span className="text-ink">milestone</span></p>
                <p><span className="text-ink-mute">pact:scope&nbsp;&nbsp;&nbsp;&nbsp;</span><span className="text-ink">Website redesign</span></p>
                <p><span className="text-ink-mute">pact:amount&nbsp;&nbsp;&nbsp;</span><span className="text-accent">$7,500 USDC</span></p>
                <p><span className="text-ink-mute">pact:status&nbsp;&nbsp;&nbsp;</span><span className="text-ink">active</span></p>
              </div>
            </motion.div>
            <motion.div
              className="terminal"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.55 }}
            >
              <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
                <span className="mono-tag text-ink-mute">release — direct on-chain</span>
              </div>
              <div className="px-4 py-3 space-y-1.5 font-mono text-[13px] leading-[18px]">
                <p><span className="text-ink-mute">$&nbsp;</span><span className="text-ink">releaseMilestone(0xa3f9…, 1)</span></p>
                <p><span className="text-accent">✓ MilestoneReleased · $3,000 → studio</span></p>
                <p><span className="text-ink-mute"># no backend in this transaction</span></p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* RECORD TICKER */}
      <RevealOnScroll>
        <section>
          <p className="text-sm text-ink-mute mb-3">The record, so far</p>
          <Marquee rows={feed} />
          <p className="text-xs text-ink-mute mt-3">
            Illustrative — every real event here is reproducible from the block
            explorer, not from Pact&rsquo;s database.
          </p>
        </section>
      </RevealOnScroll>

      {/* FAILURES */}
      <section className="py-24">
        <RevealOnScroll>
          <h2 className="text-5xl font-normal tracking-[-1.2px] leading-[1.1] mb-8 max-w-2xl">
            Two businesses want to work together. Right now, that&rsquo;s a
            Word doc and a hope.
          </h2>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-3 gap-px bg-line border border-line">
          {failures.map((f, i) => (
            <RevealOnScroll key={f.label} delay={i * 0.1} className="bg-canvas-soft p-6">
              <p className="text-3xl mb-2">
                <StatCounter value={f.value} suffix={f.suffix} />
              </p>
              <p className="text-sm mb-3 text-ink">{f.label}</p>
              <p className="text-sm text-ink-body">{f.body}</p>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* FIXES */}
      <section className="py-24 border-t border-line">
        <RevealOnScroll>
          <h2 className="text-5xl font-normal tracking-[-1.2px] leading-[1.1] mb-3">How Pact fixes it</h2>
          <p className="text-ink-body max-w-xl mb-8">
            Terms live on ENS — readable by anyone, disputable by nobody. Both
            parties escrow USDC before work begins. Completion emits an
            on-chain event that becomes permanent, portable reputation.
          </p>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-2 gap-6">
          {fixes.map((f, i) => (
            <RevealOnScroll key={f.title} delay={i * 0.08}>
              <motion.div
                className="plate rounded p-6 h-full"
                whileHover={{ y: -3 }}
                transition={{ duration: 0.15 }}
              >
                <div className="w-9 h-9 flex items-center justify-center border border-line rounded mb-4 text-accent">
                  <TemplateIcon id={f.icon} size={20} />
                </div>
                <p className="mb-2 text-ink">{f.title}</p>
                <p className="text-sm text-ink-body">{f.body}</p>
              </motion.div>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* CLOSING */}
      <section className="py-24 border-t border-line text-center">
        <RevealOnScroll>
          <Seal size={36} tone="accent" className="mx-auto mb-6" />
          <p className="font-serif italic text-5xl mb-6 max-w-2xl mx-auto leading-[1.1]">
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
