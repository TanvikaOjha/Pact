"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";

const failures = [
  {
    stat: "40%",
    label: "of B2B payment delays",
    body: "are disputes over what was agreed — a Word doc said one thing, an invoice said another.",
  },
  {
    stat: "0",
    label: "portable reputation",
    body: "A five-star rating on a marketplace is the marketplace's data. It doesn't survive a ban or a shutdown.",
  },
  {
    stat: "1-sided",
    label: "clientflow tools",
    body: "The provider sends a contract and hopes. The client can ghost after work begins.",
  },
];

const feed = [
  { a: "harbor-studio.pact.eth", b: "north-supply.pact.eth", tpl: "Milestone", value: "$7,500", flag: "on time" },
  { a: "delta-labs.pact.eth", b: "unit-agency.pact.eth", tpl: "Retainer", value: "$2,000/mo", flag: "active" },
  { a: "forge-collective.pact.eth", b: "reef-client.pact.eth", tpl: "Split", value: "$10,000", flag: "atomic" },
];

export default function Landing() {
  const { currentBusiness } = useStore();
  const ctaHref = currentBusiness ? "/templates" : "/identity";

  return (
    <div>
      <section className="pt-16 pb-14 binding pl-6 -ml-6">
        <p className="mono-tag text-ink-faint mb-5">Pact</p>
        <h1 className="font-serif text-[2.6rem] sm:text-[3.4rem] leading-[1.08] max-w-2xl">
          Both parties commit. Both parties can verify. Neither can ghost.
        </h1>
        <p className="mt-5 text-lg text-ink-soft max-w-lg">
          Six contract templates. USDC escrow. Reputation that&rsquo;s yours,
          not ours.
        </p>
        <div className="mt-8 flex items-center gap-4">
          <Link href={ctaHref} className="btn-primary">
            Start an engagement
          </Link>
          <span className="text-sm text-ink-faint">
            No wallet connect. No chain selector. Email only.
          </span>
        </div>
      </section>

      <section className="py-10 border-t border-rule">
        <p className="text-sm text-ink-faint mb-4">The record, so far</p>
        <div>
          {feed.map((f, i) => (
            <div key={i} className="registry-row py-3 flex items-center gap-4 text-sm">
              <span className="font-mono w-52 truncate">{f.a}</span>
              <span className="text-ink-faint">↔</span>
              <span className="font-mono w-52 truncate">{f.b}</span>
              <span className="text-ink-faint w-24">{f.tpl}</span>
              <span className="font-mono w-24">{f.value}</span>
              <span className="text-stamp ml-auto">{f.flag}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-faint mt-3">
          Illustrative — every real event here is reproducible from the block
          explorer, not from Pact&rsquo;s database.
        </p>
      </section>

      <section className="py-14 border-t border-rule">
        <h2 className="font-serif text-2xl mb-8 max-w-lg">
          Two businesses want to work together. Right now, that&rsquo;s a
          Word doc and a hope.
        </h2>
        <div className="grid sm:grid-cols-3 gap-px bg-rule">
          {failures.map((f) => (
            <div key={f.label} className="bg-paper-bright p-6">
              <p className="font-serif text-3xl mb-2">{f.stat}</p>
              <p className="text-sm mb-3">{f.label}</p>
              <p className="text-sm text-ink-soft">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-14 border-t border-rule">
        <h2 className="font-serif text-2xl mb-3">How Pact fixes it</h2>
        <p className="text-ink-soft max-w-xl mb-8">
          Terms live on ENS — readable by anyone, disputable by nobody. Both
          parties escrow USDC before work begins. Completion emits an
          on-chain event that becomes permanent, portable reputation.
        </p>
        <div className="grid sm:grid-cols-2 gap-6">
          {[
            ["Verify before you sign", "Resolve the proposed terms live on ENS. What you see is what's going on-chain — no PDF, no 'our records show.'"],
            ["Backend-optional release", "releaseMilestone() is callable directly by the accepting party's wallet. If Pact's server disappears, your payment still releases."],
            ["Reputation you keep", "Every completed engagement emits a PactCompleted event. Anyone can reproduce your track record from the block explorer."],
            ["Atomic split delivery", "Two providers, one client, one transaction. Neither has to trust the other with the split."],
          ].map(([title, body]) => (
            <div key={title} className="border border-rule p-5 bg-paper-bright">
              <p className="mb-2">{title}</p>
              <p className="text-sm text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-14 border-t border-rule text-center">
        <p className="font-serif text-xl italic mb-6 max-w-md mx-auto">
          &ldquo;Your contract is an ENS name. Your reputation is an event
          log. Neither belongs to us.&rdquo;
        </p>
        <Link href={ctaHref} className="btn-primary">
          Start an engagement
        </Link>
      </section>
    </div>
  );
}
