"use client";

import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useStore } from "@/lib/store";
import { formatDate, formatUSDC, truncateMid } from "@/lib/utils";
import { templateName } from "@/lib/templates";
import TemplateIcon from "../../../components/TemplateIcon";
import StatCounter from "../../../components/StatCounter";
import RadialGauge from "../../../components/RadialGauge";
import RevealOnScroll from "../../../components/RevealOnScroll";
import Seal from "../../../components/Seal";

export default function ProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const { getBusinessBySlug, reputationFor } = useStore();
  const business = getBusinessBySlug(slug);

  if (!business) {
    return (
      <div className="py-16">
        <p>No business found at {slug}.pact.eth yet.</p>
      </div>
    );
  }

  const events = reputationFor(business.id);
  const onTimeRate = events.length
    ? Math.round((events.filter((e) => e.onTime).length / events.length) * 100)
    : 100;

  return (
    <div className="py-14 max-w-3xl">
      <motion.div
        className="flex items-center gap-4 mb-1"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Seal size={34} tone="stamp" />
        <div>
          <p className="font-serif text-3xl">{business.ensSubname}</p>
          <p className="text-sm text-stamp">World verified ✓</p>
        </div>
      </motion.div>
      <p className="text-sm text-ink-faint mb-8">
        Member since {formatDate(business.joinedAt)}
      </p>

      <RevealOnScroll>
        <div className="flex flex-wrap items-center gap-8 border border-rule bg-paper-bright p-6 mb-10">
          <RadialGauge percent={onTimeRate} label="on-time completion rate" />
          <div className="grid grid-cols-3 gap-8 flex-1 min-w-[220px]">
            <div>
              <p className="font-serif text-2xl">
                <StatCounter value={business.completedCount} />
              </p>
              <p className="text-xs text-ink-faint mt-1">engagements completed</p>
            </div>
            <div>
              <p className="font-serif text-2xl">
                <StatCounter value={business.totalValue} prefix="$" />
              </p>
              <p className="text-xs text-ink-faint mt-1">total value</p>
            </div>
            <div>
              <p className="font-serif text-2xl">
                <StatCounter value={business.disputeCount} />
              </p>
              <p className="text-xs text-ink-faint mt-1">disputes</p>
            </div>
          </div>
        </div>
      </RevealOnScroll>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-faint">
          Track record — from on-chain events, verify yourself
        </p>
        <span className="mono-tag text-slate">Etherscan ↗</span>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-ink-faint py-6 border border-rule bg-paper-bright text-center">
          Nothing on-chain yet. Complete your first engagement to start the record.
        </p>
      ) : (
        <div>
          {events.map((e, i) => (
            <RevealOnScroll key={e.id} delay={Math.min(i * 0.05, 0.3)}>
              <div className="registry-row py-3 flex items-center gap-4 text-sm">
                <TemplateIcon id={e.templateType} size={16} className="text-ink-faint shrink-0" />
                <span className="w-24 text-ink-faint hidden sm:inline">
                  {templateName(e.templateType)}
                </span>
                <span className="font-mono w-44 truncate">{e.counterpartySlug}.pact.eth</span>
                <span className="font-mono w-24">{formatUSDC(e.totalValue)}</span>
                <span className={e.disputed ? "text-danger" : "text-stamp"}>
                  {e.disputed ? "Disputed" : e.onTime ? "On time" : "Late"}
                </span>
                <span className="text-ink-faint ml-auto hidden sm:inline">
                  {formatDate(e.emittedAt)}
                </span>
                <span className="mono-tag text-ink-faint w-24 shrink-0 hidden md:inline">
                  {truncateMid(e.txHash)}
                </span>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-faint mt-6">
        No platform rating. No stars. Just facts from{" "}
        <span className="font-mono">PactCompleted</span> events — reproducible by anyone,
        owned by nobody but {business.slug}.
      </p>
    </div>
  );
}
