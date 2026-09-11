"use client";

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
}

const statusLabel: Record<Milestone["status"], string> = {
  pending: "Pending",
  submitted: "Awaiting acceptance",
  released: "Released",
  disputed: "Disputed",
};

const statusColor: Record<Milestone["status"], string> = {
  pending: "text-ink-faint",
  submitted: "text-ember",
  released: "text-stamp",
  disputed: "text-danger",
};

export default function MilestoneRow({
  milestone,
  isProvider,
  onSubmit,
  onAccept,
  onDispute,
  onAutoRelease,
  autoReleaseTemplate,
}: Props) {
  const m = milestone;
  return (
    <div className="registry-row py-4 flex items-center gap-4">
      <div className="w-6 text-center">
        {m.status === "released" ? (
          <span className="text-stamp">✓</span>
        ) : m.status === "disputed" ? (
          <span className="text-danger">!</span>
        ) : m.status === "submitted" ? (
          <span className="text-ember">◉</span>
        ) : (
          <span className="text-ink-faint">○</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm">{m.name}</p>
        <p className="text-xs text-ink-faint truncate">{m.deliverable}</p>
      </div>

      <div className="text-sm w-24 shrink-0 font-mono">{formatUSDC(m.amount)}</div>
      <div className="text-xs w-28 shrink-0 text-ink-faint">Due {formatDate(m.due)}</div>
      <div className={`text-xs w-32 shrink-0 ${statusColor[m.status]}`}>
        {statusLabel[m.status]}
        {m.worldVerifiedAt && <span className="text-ink-faint"> · selfie ✓</span>}
      </div>

      <div className="w-44 shrink-0 flex justify-end gap-2">
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
  );
}
