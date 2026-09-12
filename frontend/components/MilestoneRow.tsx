"use client";

import { motion } from "framer-motion";
import { Milestone } from "@/lib/types";
import { formatDate, formatUSDC } from "@/lib/utils";

interface Props {
  milestone: Milestone;
  isProvider: boolean;
  worldRequired: boolean;
  onSubmit: () => void;
  onAccept: () => void;
  onDispute: () => void;
  onAutoRelease: () => void;
  autoReleaseTemplate: boolean;
  isLast: boolean;
}

const statusLabel: Record<Milestone["status"], string> = {
  pending: "Pending",
  submitted: "Awaiting acceptance",
  released: "Released",
  disputed: "Disputed",
};

const statusPill: Record<Milestone["status"], string> = {
  pending: "text-ink-faint border-rule",
  submitted: "text-ember border-ember/50 bg-ember-soft",
  released: "text-stamp border-stamp/50 bg-stamp-soft",
  disputed: "text-danger border-danger/50 bg-danger-soft",
};

export default function MilestoneRow({
  milestone: m,
  isProvider,
  onSubmit,
  onAccept,
  onDispute,
  onAutoRelease,
  autoReleaseTemplate,
  isLast,
}: Props) {
  return (
    <div className="relative flex gap-4 pb-7">
      {!isLast && (
        <span className="absolute left-[13px] top-7 bottom-0 w-px bg-rule" />
      )}

      <div className="relative z-10 shrink-0 pt-0.5">
        <div
          className={`w-7 h-7 rounded-full border flex items-center justify-center bg-paper-bright ${
            m.status === "released"
              ? "border-stamp"
              : m.status === "disputed"
              ? "border-danger"
              : m.status === "submitted"
              ? "border-ember"
              : "border-rule"
          }`}
        >
          {m.status === "released" ? (
            <motion.svg width="14" height="14" viewBox="0 0 14 14">
              <motion.path
                d="M2.5 7.2L5.5 10.5L11.5 3.5"
                fill="none"
                stroke="#1F5C46"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </motion.svg>
          ) : m.status === "disputed" ? (
            <span className="text-danger text-sm leading-none">!</span>
          ) : m.status === "submitted" ? (
            <span className="w-2 h-2 rounded-full bg-ember" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-rule-dark" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 max-w-sm">
          <p className="text-sm">{m.name}</p>
          <p className="text-xs text-ink-faint truncate">{m.deliverable}</p>
          <p className="text-xs text-ink-faint mt-1">Due {formatDate(m.due)}</p>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">{formatUSDC(m.amount)}</span>
          <span className={`text-xs px-2 py-1 border ${statusPill[m.status]}`}>
            {statusLabel[m.status]}
            {m.worldVerifiedAt && <span className="opacity-70"> · selfie ✓</span>}
          </span>
        </div>

        <div className="flex gap-2 w-full sm:w-auto justify-end">
          {m.status === "pending" && isProvider && (
            <button onClick={onSubmit} className="btn-ghost text-xs px-3 py-1.5">
              Submit completion
            </button>
          )}
          {m.status === "pending" && !isProvider && autoReleaseTemplate && (
            <button onClick={onAutoRelease} className="btn-ghost text-xs px-3 py-1.5">
              Simulate auto-release
            </button>
          )}
          {m.status === "submitted" && !isProvider && (
            <>
              <button onClick={onDispute} className="btn-ghost text-xs px-3 py-1.5">
                Dispute
              </button>
              <button onClick={onAccept} className="btn-primary text-xs px-3 py-1.5">
                Accept
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
