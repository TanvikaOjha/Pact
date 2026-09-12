"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useStore } from "@/lib/store";
import MilestoneRow from "@/components/MilestoneRow";
import WorldSelfieModal from "@/components/WorldSelfieModal";
import TerminalBlock from "@/components/TerminalBlock";
import TemplateIcon from "@/components/TemplateIcon";
import { formatUSDC } from "@/lib/utils";
import { templateName, WORLD_THRESHOLD } from "@/lib/templates";

const AUTO_RELEASE_TEMPLATES = new Set(["retainer", "t-and-m", "recurring"]);

export default function EngagementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    getEngagement,
    getBusiness,
    currentBusiness,
    submitCompletion,
    acceptMilestone,
    autoRelease,
    disputeMilestone,
    resolveDispute,
  } = useStore();

  const engagement = getEngagement(id);
  const [viewAs, setViewAs] = useState<"provider" | "counterparty">("provider");
  const [backendDown, setBackendDown] = useState(false);
  const [pendingWorldCheck, setPendingWorldCheck] = useState<number | null>(null);

  const partyA = engagement ? getBusiness(engagement.partyAId) : undefined;
  const partyB = engagement?.partyBId ? getBusiness(engagement.partyBId) : undefined;

  const released = useMemo(
    () => (engagement ? engagement.milestones.filter((m) => m.status === "released") : []),
    [engagement]
  );
  const escrowRemaining = engagement
    ? engagement.totalAmount - released.reduce((s, m) => s + m.amount, 0)
    : 0;

  if (!engagement) return <div className="py-16">Engagement not found.</div>;
  if (engagement.status === "proposed") {
    router.replace(`/proposal/${engagement.id}`);
    return null;
  }

  const isProvider = viewAs === "provider";
  const isAutoTemplate = AUTO_RELEASE_TEMPLATES.has(engagement.templateType);

  function handleAccept(index: number) {
    const m = engagement!.milestones.find((mm) => mm.index === index);
    if (m?.worldRequired) {
      setPendingWorldCheck(index);
      return;
    }
    void acceptMilestone(engagement!.id, index, false).then(() => {
      if (backendDown) {
        // Cosmetic reinforcement of the FilePizza mechanic — same call either way.
      }
    });
  }

  const releasedTotal = released.reduce((s, m) => s + m.amount, 0);
  const progressPct = engagement.totalAmount
    ? Math.round((releasedTotal / engagement.totalAmount) * 100)
    : 0;

  return (
    <motion.div
      className="py-14"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {pendingWorldCheck !== null && (
        <WorldSelfieModal
          reason={`Confirming acceptance of milestone ${pendingWorldCheck + 1} (above ${formatUSDC(WORLD_THRESHOLD)})`}
          onDone={async () => {
            await acceptMilestone(engagement.id, pendingWorldCheck, true);
            setPendingWorldCheck(null);
          }}
        />
      )}

      <div className="flex items-start justify-between mb-2 gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 border border-rule flex items-center justify-center text-stamp shrink-0 mt-0.5">
            <TemplateIcon id={engagement.templateType} size={20} />
          </div>
          <div>
            <p className="mono-tag text-ink-faint mb-1">{templateName(engagement.templateType)}</p>
            <h1 className="font-serif text-3xl">{engagement.title}</h1>
          </div>
        </div>
        <span
          className={`text-xs px-2 py-1 border capitalize shrink-0 ${
            engagement.status === "completed"
              ? "border-stamp text-stamp"
              : engagement.status === "disputed"
              ? "border-danger text-danger"
              : "border-rule text-ink-faint"
          }`}
        >
          {engagement.status}
        </span>
      </div>

      <p className="font-mono text-sm text-ink-faint mb-1">
        {partyA?.ensSubname ?? "…"} ↔ {partyB?.ensSubname ?? `${engagement.partyBSlug}.pact.eth`}
      </p>
      <p className="font-mono text-sm text-slate mb-3">
        {engagement.ensSubname} ↗ &nbsp;·&nbsp; {formatUSDC(escrowRemaining)} USDC in escrow
      </p>

      <div className="h-1 bg-rule mb-8 max-w-md">
        <motion.div
          className="h-1 bg-stamp"
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setViewAs("provider")}
            className={`px-3 py-1.5 border ${
              isProvider ? "border-ink bg-ink text-paper-bright" : "border-rule"
            }`}
          >
            View as provider
          </button>
          <button
            onClick={() => setViewAs("counterparty")}
            className={`px-3 py-1.5 border ${
              !isProvider ? "border-ink bg-ink text-paper-bright" : "border-rule"
            }`}
          >
            View as accepting party
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-faint">
          <input
            type="checkbox"
            checked={backendDown}
            onChange={(e) => setBackendDown(e.target.checked)}
          />
          Simulate Pact's backend being down
        </label>
      </div>

      {backendDown && (
        <p className="text-xs text-ember mb-4 border border-ember/40 bg-ember-soft px-3 py-2">
          Backend offline. Accept and auto-release still call{" "}
          <span className="font-mono">PactEscrow</span> directly from the accepting wallet — no
          server in the path.
        </p>
      )}

      <div className="mb-10 border-l-0">
        {engagement.milestones.map((m, i) => (
          <MilestoneRow
            key={m.index}
            milestone={m}
            isProvider={isProvider}
            worldRequired={m.worldRequired}
            autoReleaseTemplate={isAutoTemplate}
            isLast={i === engagement.milestones.length - 1}
            onSubmit={() => submitCompletion(engagement.id, m.index)}
            onAccept={() => handleAccept(m.index)}
            onDispute={() => disputeMilestone(engagement.id, m.index)}
            onAutoRelease={() => autoRelease(engagement.id, m.index)}
          />
        ))}
      </div>

      {engagement.status === "disputed" && (
        <div className="border border-danger/40 bg-danger/5 p-4 mb-8">
          <p className="text-sm mb-3">
            Disputed. No third-party arbitration in MVP — both parties must co-sign a
            resolution before USDC moves again.
          </p>
          <button
            onClick={() =>
              resolveDispute(
                engagement.id,
                engagement.milestones.find((m) => m.status === "disputed")!.index
              )
            }
            className="btn-ghost text-sm"
          >
            Simulate both parties co-signing resolution →
          </button>
        </div>
      )}

      {engagement.templateType === "split" && (
        <TerminalBlock
          title="Atomic split, one transaction"
          records={[
            [partyA?.ensSubname ?? "party-a", formatUSDC(((engagement.splitShareA ?? 5000) / 10000) * engagement.totalAmount)],
            [partyB?.ensSubname ?? `${engagement.partyBSlug}.pact.eth`, formatUSDC(((engagement.splitShareB ?? 5000) / 10000) * engagement.totalAmount)],
          ]}
        />
      )}

      {engagement.status === "completed" && partyA && (
        <div className="border border-stamp bg-stamp-soft p-5 mt-8">
          <p className="text-sm text-stamp mb-2">
            PactCompleted emitted. This is now a permanent line in both parties&rsquo;
            reputation.
          </p>
          <button
            onClick={() => router.push(`/profile/${partyA.slug}`)}
            className="btn-ghost text-sm"
          >
            View reputation profile →
          </button>
        </div>
      )}
    </motion.div>
  );
}
