"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toaster";
import {
  loadEngagement,
  saveEngagement,
  type LocalEngagement,
  type LocalMilestone,
} from "@/lib/utils";
import { ApiError } from "@/lib/api";
import MilestoneRow from "@/components/MilestoneRow";
import WorldSelfieModal from "@/components/WorldSelfieModal";
import TerminalBlock from "@/components/TerminalBlock";
import TemplateIcon from "@/components/TemplateIcon";
import VerifyStamp from "@/components/VerifyStamp";
import { formatUSDC } from "@/lib/utils";
import { WORLD_THRESHOLD } from "@/lib/templates";
import type { TemplateType } from "@/lib/types";

const EVIDENCE_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export default function EngagementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { api, walletAddress } = useAuth();
  const { pushToast } = useToast();
  const [engagement, setEngagement] = useState<LocalEngagement | null>(() => loadEngagement(id));
  const [viewAsOverride, setViewAsOverride] = useState<"provider" | "counterparty" | null>(null);
  const viewAs =
    viewAsOverride ??
    (engagement !== null &&
    walletAddress !== null &&
    walletAddress.toLowerCase() !== engagement.proposerWallet.toLowerCase()
      ? "counterparty"
      : "provider");
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [pendingWorldCheck, setPendingWorldCheck] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Record<number, string>>({});
  const [resolving, setResolving] = useState<number | null>(null);
  const [split, setSplit] = useState({ providerAmount: 0, clientRefund: 0 });

  if (!engagement) {
    return (
      <div className="py-16 max-w-2xl">
        <p className="text-ink-body">Engagement record not found in this browser.</p>
        <p className="text-sm text-ink-mute mt-2">
          Records live alongside the proposal link that created them — open it
          to rebuild this view, or start a new engagement.
        </p>
        <button onClick={() => router.push("/templates")} className="btn-primary mt-6">
          Start an engagement
        </button>
      </div>
    );
  }

  const isProvider = viewAs === "provider";
  const released = engagement.milestones.filter((m) => m.releasedAt !== null);
  const releasedTotal = released.reduce((s, m) => s + m.amount, 0);
  const escrowRemaining = engagement.totalAmount - releasedTotal;
  const progressPct = engagement.totalAmount
    ? Math.round((releasedTotal / engagement.totalAmount) * 100)
    : 0;

  function patchMilestone(index: number, patch: Partial<LocalMilestone>) {
    setEngagement((prev) => {
      if (!prev) return prev;
      const next: LocalEngagement = {
        ...prev,
        milestones: prev.milestones.map((m) =>
          m.index === index ? { ...m, ...patch } : m
        ),
      };
      saveEngagement(next);
      return next;
    });
  }

  function setStatus(status: LocalEngagement["status"]) {
    setEngagement((prev) => {
      if (!prev) return prev;
      const next = { ...prev, status };
      saveEngagement(next);
      return next;
    });
  }

  async function run(index: number, label: string, fn: () => Promise<void>) {
    setBusyIndex(index);
    try {
      await fn();
    } catch (err) {
      pushToast(
        err instanceof ApiError ? `${label} failed (${err.code ?? err.status}).` : `${label} failed.`,
        "danger",
      );
    } finally {
      setBusyIndex(null);
    }
  }

  function handleSubmit(index: number) {
    const eng = engagement;
    if (!eng) return;
    const raw = (evidence[index] ?? "").trim();
    if (raw !== "" && !EVIDENCE_PATTERN.test(raw)) {
      pushToast("Evidence must be a 0x + 64 hex hash.", "danger");
      return;
    }
    void run(index, "Submit", async () => {
      const res = await api.submitMilestone(
        eng.id,
        index,
        raw === "" ? undefined : raw,
      );
      patchMilestone(index, {
        submittedAt: res.submittedAt,
        late: res.late,
        evidenceHash: res.evidenceHash,
      });
      pushToast("Completion submitted — acceptance window open.", "accent");
    });
  }

  function handleAccept(index: number) {
    if (!engagement) return;
    const m = engagement.milestones.find((mm) => mm.index === index);
    if (!m) return;
    if (m.worldRequired || m.amount >= WORLD_THRESHOLD) {
      setPendingWorldCheck(index);
      return;
    }
    void doRelease(index);
  }

  function doRelease(index: number, viaExecute = false) {
    const eng = engagement;
    if (!eng) return;
    void run(index, "Release", async () => {
      const res = await api.releaseMilestone(eng.id, index, viaExecute || undefined);
      patchMilestone(index, { releasedAt: res.releasedAt, disputed: false });
      if (res.engagementCompleted) setStatus("COMPLETED");
      pushToast("USDC released directly on-chain.", "accent");
    });
  }

  function handleDispute(index: number) {
    const eng = engagement;
    if (!eng) return;
    void run(index, "Dispute", async () => {
      await api.raiseDispute(eng.id, index);
      patchMilestone(index, { disputed: true });
      setStatus("DISPUTED");
      pushToast("Milestone disputed — funds frozen.", "danger");
    });
  }

  function openResolve(index: number, amount: number) {
    setResolving(index);
    setSplit({ providerAmount: amount, clientRefund: 0 });
  }

  function handleResolve(index: number) {
    const eng = engagement;
    if (!eng) return;
    void run(index, "Resolve", async () => {
      const res = await api.resolveDispute(
        eng.id,
        index,
        split.providerAmount,
        split.clientRefund,
      );
      if (res.resolved) {
        patchMilestone(index, { releasedAt: res.releasedAt ?? new Date().toISOString(), disputed: false });
        setStatus(res.engagementCompleted ? "COMPLETED" : "ACTIVE");
        pushToast("Co-signed — resolution executed.", "accent");
      } else {
        pushToast("Vote recorded — awaiting counterparty co-sign.", "accent");
      }
      setResolving(null);
    });
  }

  function handlePropose(index: number) {
    const eng = engagement;
    if (!eng) return;
    void run(index, "Propose", async () => {
      const res = await api.proposeResolution(
        eng.id,
        index,
        split.providerAmount,
        split.clientRefund,
      );
      pushToast(`Proposed — auto-executes past ${res.challengeDeadline}.`, "accent");
      setResolving(null);
    });
  }

  function handleChallenge(index: number) {
    const eng = engagement;
    if (!eng) return;
    void run(index, "Challenge", async () => {
      await api.challengeResolution(eng.id, index);
      pushToast("Challenged — pre-agreed default will execute.", "accent");
    });
  }

  const templateId = (["fixed", "milestone", "retainer", "t-and-m", "recurring", "split"][
    engagement.templateType - 1
  ] ?? "custom") as TemplateType;

  return (
    <motion.div
      className="py-14"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {pendingWorldCheck !== null && (
        <WorldSelfieModal
          reason={`Confirming acceptance of milestone ${pendingWorldCheck + 1} (high value)`}
          onDone={(passed) => {
            const eng = engagement;
            const index = pendingWorldCheck;
            setPendingWorldCheck(null);
            if (!passed || !eng || index === null) return;
            void run(index, "World check", async () => {
              await api.worldCheck(eng.id, index, { responses: [] });
              const res = await api.releaseMilestone(eng.id, index);
              patchMilestone(index, { releasedAt: res.releasedAt, disputed: false });
              if (res.engagementCompleted) setStatus("COMPLETED");
              pushToast("Selfie bound — USDC released.", "accent");
            });
          }}
        />
      )}

      <div className="flex items-start justify-between mb-2 gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 border border-line rounded flex items-center justify-center text-accent shrink-0 mt-0.5">
            <TemplateIcon id={templateId} size={20} />
          </div>
          <div>
            <p className="mono-tag text-ink-mute mb-1">{engagement.templateName}</p>
            <h1 className="text-3xl font-medium tracking-[-0.8px] text-ink">{engagement.title}</h1>
          </div>
        </div>
        <span className="pill capitalize shrink-0 text-ink-body">{engagement.status.toLowerCase()}</span>
      </div>

      <p className="font-mono text-sm text-ink-mute mb-1">
        {engagement.ensSubname} · {formatUSDC(escrowRemaining)} USDC in escrow
      </p>

      <div className="h-1 bg-line mb-8 max-w-md rounded-full overflow-hidden">
        <div className="h-1 bg-accent transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="flex gap-2 mb-8">
        {(["provider", "counterparty"] as const).map((side) => (
          <button
            key={side}
            onClick={() => setViewAsOverride(side)}
            className={`text-xs px-3 py-1.5 rounded border capitalize ${
              viewAs === side
                ? "border-accent text-accent"
                : "border-line text-ink-mute hover:text-ink"
            }`}
          >
            {side}
          </button>
        ))}
        <span className="text-xs text-ink-mute self-center ml-2">
          acting as {isProvider ? "provider (submits)" : "counterparty (accepts)"}
        </span>
      </div>

      <div className="mb-10">
        {engagement.milestones.map((m) => (
          <div key={m.index}>
            <MilestoneRow
              milestone={m}
              isProvider={isProvider}
              busy={busyIndex === m.index}
              autoReleaseTemplate={false}
              isLast={m.index === engagement.milestones.length - 1}
              onSubmit={() => handleSubmit(m.index)}
              onAccept={() => handleAccept(m.index)}
              onDispute={() => handleDispute(m.index)}
              onResolve={() => openResolve(m.index, m.amount)}
            />
            {m.submittedAt === null && isProvider && (
              <div className="ml-11 mb-5 -mt-3">
                <input
                  className="field-input text-xs font-mono"
                  placeholder="optional evidence hash 0x… (M4)"
                  value={evidence[m.index] ?? ""}
                  onChange={(e) =>
                    setEvidence((prev) => ({ ...prev, [m.index]: e.target.value }))
                  }
                />
              </div>
            )}
            {resolving === m.index && (
              <div className="ml-11 mb-5 -mt-3 plate rounded p-4">
                <p className="mono-tag text-ink-mute mb-3">Resolution split — must sum to {formatUSDC(m.amount)}</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <label className="block text-xs text-ink-body">
                    To provider
                    <input
                      type="number"
                      className="field-input mt-1"
                      value={split.providerAmount}
                      onChange={(e) =>
                        setSplit((s) => ({ ...s, providerAmount: Number(e.target.value) }))
                      }
                    />
                  </label>
                  <label className="block text-xs text-ink-body">
                    Refund to client
                    <input
                      type="number"
                      className="field-input mt-1"
                      value={split.clientRefund}
                      onChange={(e) =>
                        setSplit((s) => ({ ...s, clientRefund: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleResolve(m.index)} disabled={busyIndex === m.index} className="btn-primary text-xs px-3 py-1.5">
                    Co-sign
                  </button>
                  <button onClick={() => handlePropose(m.index)} disabled={busyIndex === m.index} className="btn-ghost text-xs px-3 py-1.5">
                    Propose (optimistic)
                  </button>
                  <button onClick={() => handleChallenge(m.index)} disabled={busyIndex === m.index} className="btn-ghost text-xs px-3 py-1.5">
                    Challenge
                  </button>
                  <button onClick={() => setResolving(null)} className="text-xs text-ink-mute px-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="max-w-2xl">
        <TerminalBlock
          title="Engagement record"
          subtitle={engagement.ensSubname}
          records={[
            ["pact:terms-hash", engagement.termsHash],
            ["pact:status", engagement.status.toLowerCase()],
            ["pact:visibility", engagement.visibility],
            ["proposal", engagement.proposalToken],
          ]}
        />
        <div className="mt-4">
          <VerifyStamp
            ensSubname={engagement.ensSubname}
            records={[
              ["pact:scope", engagement.scope],
              ["pact:amount", String(engagement.totalAmount)],
              ["pact:status", engagement.status.toLowerCase()],
            ]}
            termsHash={engagement.termsHash}
          />
        </div>
      </div>
    </motion.div>
  );
}
