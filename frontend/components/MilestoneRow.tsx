"use client";

import { motion } from "framer-motion";
import type { LocalMilestone } from "@/lib/utils";
import { formatDate, formatUSDC } from "@/lib/utils";

interface Props {
  milestone: LocalMilestone;
  isProvider: boolean;
  busy: boolean;
  autoReleaseTemplate: boolean;
  isLast: boolean;
  onSubmit: () => void;
  onAccept: () => void;
  onDispute: () => void;
  onResolve: () => void;
}

type VisualStatus = "pending" | "submitted" | "released" | "disputed";

function visualStatus(m: LocalMilestone): VisualStatus {
  if (m.releasedAt !== null) return "released";
  if (m.disputed) return "disputed";
  if (m.submittedAt !== null) return "submitted";
  return "pending";
}

const statusLabel: Record<VisualStatus, string> = {
  pending: "Pending",
  submitted: "Awaiting acceptance",
  released: "Released",
  disputed: "Disputed",
};

const statusPill: Record<VisualStatus, string> = {
  pending: "text-ink-mute border-line",
  submitted: "text-warn border-warn/50 bg-warn-dim",
  released: "text-accent border-accent/50 bg-accent/10",
  disputed: "text-danger border-danger/50 bg-danger-dim",
};

export default function MilestoneRow({
  milestone: m,
  isProvider,
  busy,
  autoReleaseTemplate,
  isLast,
  onSubmit,
  onAccept,
  onDispute,
  onResolve,
}: Props) {
  const status = visualStatus(m);
  return (
    <div className="relative flex gap-4 pb-7">
      {!isLast && (
        <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line" />
      )}

      <div className="relative z-10 shrink-0 pt-0.5">
        <div
          className={`w-7 h-7 rounded-full border flex items-center justify-center bg-canvas ${
            status === "released"
              ? "border-accent"
              : status === "disputed"
              ? "border-danger"
              : status === "submitted"
              ? "border-warn"
              : "border-line"
          }`}
        >
          {status === "released" ? (
            <motion.svg width="14" height="14" viewBox="0 0 14 14">
              <motion.path
                d="M2.5 7.2L5.5 10.5L11.5 3.5"
                fill="none"
                stroke="#2DD4BF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </motion.svg>
          ) : status === "disputed" ? (
            <span className="text-danger text-sm leading-none">!</span>
          ) : status === "submitted" ? (
            <span className="w-2 h-2 rounded-full bg-warn" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-line" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-sm">
          <p className="text-sm text-ink">{m.name}</p>
          <p className="text-xs text-ink-mute truncate">{m.deliverable}</p>
          <p className="text-xs text-ink-mute mt-1">
            Due {formatDate(m.due)}
            {m.late && <span className="text-danger"> · late</span>}
            {m.evidenceHash && (
              <span className="text-accent"> · evidence ✓</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">{formatUSDC(m.amount)}</span>
          <span className={`pill ${statusPill[status]}`}>
            {statusLabel[status]}
            {m.worldRequired && <span className="opacity-70"> · selfie</span>}
          </span>
        </div>

        <div className="flex gap-2 w-full sm:w-auto justify-end">
          {status === "pending" && isProvider && (
            <button onClick={onSubmit} disabled={busy} className="btn-ghost text-xs px-3 py-1.5">
              Submit completion
            </button>
          )}
          {status === "submitted" && !isProvider && (
            <>
              <button onClick={onDispute} disabled={busy} className="btn-ghost text-xs px-3 py-1.5">
                Dispute
              </button>
              <button onClick={onAccept} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
                Accept
              </button>
            </>
          )}
          {status === "disputed" && (
            <button onClick={onResolve} disabled={busy} className="btn-ghost text-xs px-3 py-1.5">
              {autoReleaseTemplate ? "Propose resolution" : "Co-sign resolution"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
