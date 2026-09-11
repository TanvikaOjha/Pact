"use client";

import { useParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { formatDate, formatUSDC, truncateMid } from "@/lib/utils";
import { templateName } from "@/lib/templates";

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
      <p className="font-serif text-3xl mb-1">{business.ensSubname}</p>
      <p className="text-sm text-stamp mb-1">World verified ✓</p>
      <p className="text-sm text-ink-faint mb-8">
        Member since {formatDate(business.joinedAt)}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-rule mb-10">
        {[
          [String(business.completedCount), "engagements completed"],
          [formatUSDC(business.totalValue), "total value"],
          [`${onTimeRate}%`, "on time"],
          [String(business.disputeCount), "disputes"],
        ].map(([stat, label]) => (
          <div key={label} className="bg-paper-bright p-5">
            <p className="font-serif text-2xl mb-1">{stat}</p>
            <p className="text-xs text-ink-faint">{label}</p>
          </div>
        ))}
      </div>

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
          {events.map((e) => (
            <div key={e.id} className="registry-row py-3 flex items-center gap-4 text-sm">
              <span className="w-24 text-ink-faint">{templateName(e.templateType)}</span>
              <span className="font-mono w-44 truncate">{e.counterpartySlug}.pact.eth</span>
              <span className="font-mono w-24">{formatUSDC(e.totalValue)}</span>
              <span className={e.disputed ? "text-danger" : "text-stamp"}>
                {e.disputed ? "Disputed" : e.onTime ? "On time" : "Late"}
              </span>
              <span className="text-ink-faint ml-auto">{formatDate(e.emittedAt)}</span>
              <span className="mono-tag text-ink-faint w-24 shrink-0">
                {truncateMid(e.txHash)}
              </span>
            </div>
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
