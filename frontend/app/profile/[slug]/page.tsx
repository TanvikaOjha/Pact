"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { formatDate, formatUSDC } from "@/lib/utils";
import { templateName } from "@/lib/templates";
import type {
  Commitment,
  CommitmentsResponse,
  PendingProposal,
  PendingProposalsResponse,
  ReputationResponse,
} from "@/lib/api";
import { ApiError } from "@/lib/api";
import TemplateIcon from "@/components/TemplateIcon";
import StatCounter from "@/components/StatCounter";
import RadialGauge from "@/components/RadialGauge";
import RevealOnScroll from "@/components/RevealOnScroll";
import Seal from "@/components/Seal";
import type { TemplateType } from "@/lib/types";

const TIER_LABEL = ["New", "Established", "Trusted", "Prime"];

export default function ProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const { api, walletAddress } = useAuth();
  const [profile, setProfile] = useState<ReputationResponse | null>(null);
  const [commitments, setCommitments] = useState<CommitmentsResponse | null>(null);
  const [pendingProposals, setPendingProposals] = useState<PendingProposalsResponse | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      if (slug === "me") {
        if (walletAddress === null) return;
        const [commitmentResponse, proposalResponse] = await Promise.all([
          api.getMyCommitments(),
          api.getMyPendingProposals(),
        ]);
        setCommitments(commitmentResponse);
        setPendingProposals(proposalResponse);
        return;
      }
      setProfile(await api.getReputation(`${slug}.pact-hack.eth`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [api, slug, walletAddress]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (slug === "me") {
    if (walletAddress === null) {
      return (
        <div className="py-16 max-w-2xl">
          <p className="text-ink-body">Sign in to view your commitments.</p>
        </div>
      );
    }
    if (commitments === null) {
      return (
        <div className="py-16">
          <p className="mono-tag text-ink-mute cursor-blink">loading commitments</p>
        </div>
      );
    }
    return (
      <CommitmentsDashboard
        data={commitments}
        pendingProposals={pendingProposals?.proposals ?? []}
      />
    );
  }

  if (missing) {
    return (
      <div className="py-16">
        <p className="text-ink-body">No business found at {slug}.pact-hack.eth yet.</p>
      </div>
    );
  }

  function CommitmentsDashboard({
    data,
    pendingProposals,
  }: {
    data: CommitmentsResponse;
    pendingProposals: PendingProposal[];
  }) {
    return (
      <div className="py-14 max-w-4xl">
        <motion.div
          className="flex items-center gap-4 mb-8"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Seal size={34} tone="accent" />
          <div>
            <p className="text-3xl tracking-tight text-ink">{data.business}</p>
            <p className="text-sm text-ink-mute mt-1">Your commitments and milestone deadlines</p>
          </div>
        </motion.div>

        {pendingProposals.length > 0 && (
          <div className="mb-8">
            <p className="text-sm text-ink-mute mb-4">Awaiting acceptance</p>
            <div className="space-y-3">
              {pendingProposals.map((proposal) => (
                <PendingProposalCard key={proposal.token} proposal={proposal} />
              ))}
            </div>
          </div>
        )}

        {data.commitments.length === 0 ? (
          <div className="plate rounded p-8 text-center">
            <p className="text-sm text-ink-body">No commitments yet.</p>
            <p className="text-xs text-ink-mute mt-2">
              Accepted engagements will appear here with their live mirror status. Proposals
              awaiting acceptance appear above.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.commitments.map((commitment) => (
              <CommitmentCard key={commitment.id} commitment={commitment} />
            ))}
          </div>
        )}
      </div>
    );
  }

  function PendingProposalCard({ proposal }: { proposal: PendingProposal }) {
    const templateId = (["fixed", "milestone", "retainer", "t-and-m", "recurring", "split"][
      proposal.templateType - 1
    ] ?? "custom") as TemplateType;
    return (
      <motion.div
        className="plate rounded p-5 block hover:border-accent transition-colors"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Link href={`/proposal/${proposal.token}`} className="block">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mono-tag text-ink-mute mb-1">
                {templateName(templateId)} · proposal sent
              </p>
              <p className="text-ink">{proposal.title}</p>
              <p className="text-sm text-ink-mute mt-1">
                Expires {formatDate(proposal.expiresAt)}
              </p>
            </div>
            <p className="text-lg text-ink">{formatUSDC(proposal.totalAmount)}</p>
          </div>
        </Link>
      </motion.div>
    );
  }

  function CommitmentCard({ commitment }: { commitment: Commitment }) {
    const templateId = (["fixed", "milestone", "retainer", "t-and-m", "recurring", "split"][
      commitment.templateType - 1
    ] ?? "custom") as TemplateType;
    return (
      <motion.div
        className="plate rounded p-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mono-tag text-ink-mute mb-1">
              {templateName(templateId)} · {commitment.role}
            </p>
            <p className="font-mono text-sm text-ink">{commitment.ensSubname}</p>
            <p className="text-sm text-ink-body mt-1">
              with {commitment.counterparty ?? "counterparty unavailable"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg text-ink">{formatUSDC(commitment.totalAmount)}</p>
            <p className="pill capitalize text-xs mt-1">{commitment.status.toLowerCase()}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-5 pt-4 border-t border-line text-xs">
          <div>
            <p className="text-ink-mute">Created</p>
            <p className="text-ink-body mt-1">{formatDate(commitment.createdAt)}</p>
          </div>
          <div>
            <p className="text-ink-mute">Deadline</p>
            <p className="text-ink-body mt-1">
              {commitment.deadline === null ? "No deadline" : formatDate(commitment.deadline)}
            </p>
          </div>
          <div>
            <p className="text-ink-mute">Milestones</p>
            <p className="text-ink-body mt-1">
              {commitment.milestones.filter((milestone) => milestone.releasedAt !== null).length}/
              {commitment.milestones.length} released
            </p>
          </div>
        </div>
        {commitment.milestones.length > 0 && (
          <div className="mt-4 space-y-2">
            {commitment.milestones.map((milestone) => (
              <div
                key={milestone.index}
                className="flex flex-wrap items-center justify-between gap-3 text-xs border-t border-line pt-2"
              >
                <span className="text-ink-body">
                  {milestone.name ?? `Milestone ${milestone.index + 1}`}
                </span>
                <span className="font-mono text-ink-mute">
                  {formatUSDC(milestone.amount)} ·{" "}
                  {milestone.dueDate === null ? "no due date" : `due ${formatDate(milestone.dueDate)}`}
                </span>
                <span className={milestone.disputed ? "text-danger" : milestone.releasedAt ? "text-accent" : "text-warn"}>
                  {milestone.disputed ? "disputed" : milestone.releasedAt ? "released" : "open"}
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  if (!profile) {
    return (
      <div className="py-16">
        <p className="mono-tag text-ink-mute cursor-blink">loading track record</p>
      </div>
    );
  }

  const onTimeRate =
    profile.onTimeRate === null ? 100 : Math.round(profile.onTimeRate * 100);

  return (
    <div className="py-14 max-w-3xl">
      <motion.div
        className="flex items-center gap-4 mb-1"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Seal size={34} tone="accent" />
        <div>
          <p className="text-3xl tracking-tight text-ink">{profile.ensSubname}</p>
          <p className="text-sm text-accent mt-1">
            {TIER_LABEL[profile.tier] ?? "New"} · score {profile.score}{" "}
            <span className="text-ink-mute font-mono text-xs">v{profile.scoreVersion}</span>
          </p>
        </div>
      </motion.div>

      <RevealOnScroll>
        <div className="flex flex-wrap items-center gap-8 plate rounded p-6 my-10">
          <RadialGauge percent={onTimeRate} label="on-time completion rate" />
          <div className="grid grid-cols-3 gap-8 flex-1 min-w-[220px]">
            <div>
              <p className="text-2xl text-ink">
                <StatCounter value={profile.completedCount} />
              </p>
              <p className="text-xs text-ink-mute mt-1">engagements completed</p>
            </div>
            <div>
              <p className="text-2xl text-ink">
                <StatCounter value={profile.totalValue} prefix="$" />
              </p>
              <p className="text-xs text-ink-mute mt-1">total value</p>
            </div>
            <div>
              <p className="text-2xl text-ink">
                <StatCounter value={profile.disputeCount} />
              </p>
              <p className="text-xs text-ink-mute mt-1">disputes</p>
            </div>
          </div>
        </div>
      </RevealOnScroll>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-ink-mute">
          Track record — from on-chain events, verify yourself
        </p>
        <span className="mono-tag text-accent">Etherscan ↗</span>
      </div>

      {profile.recent.length === 0 ? (
        <div className="plate rounded p-8 text-center">
          <p className="text-sm text-ink-body">No completed engagements yet.</p>
          <p className="text-xs text-ink-mute mt-2">
            History accumulates here from PactCompleted events — nobody can take it away.
          </p>
        </div>
      ) : (
        <div className="border border-line rounded overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 bg-canvas-soft mono-tag text-ink-mute">
            <span>Counterparty</span>
            <span>Type</span>
            <span className="text-right">Value</span>
            <span className="text-right">Outcome</span>
          </div>
          {profile.recent.map((item, i) => {
            const templateId = (["fixed", "milestone", "retainer", "t-and-m", "recurring", "split"][
              item.templateType - 1
            ] ?? "custom") as TemplateType;
            return (
              <div
                key={`${item.emittedAt}-${i}`}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 border-t border-line text-sm items-center"
              >
                <span className="font-mono text-xs text-ink-body truncate">
                  {item.redacted ? "(sealed)" : (item.counterpartySubname ?? "—")}
                </span>
                <span className="flex items-center gap-2 text-ink-mute text-xs">
                  <TemplateIcon id={templateId} size={14} />
                  {templateName(templateId)}
                </span>
                <span className="font-mono text-right text-ink-body">
                  {formatUSDC(item.totalValue)}
                </span>
                <span
                  className={`text-right text-xs ${
                    item.disputed ? "text-danger" : item.onTime ? "text-accent" : "text-warn"
                  }`}
                >
                  {item.disputed ? "disputed" : item.onTime ? "on time" : "late"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-ink-mute mt-4">
        Score recomputable from the events above — formula v{profile.scoreVersion}, attested on-chain.
      </p>
    </div>
  );
}
