"use client";

import { useEffect, useState } from "react";

interface Props {
  reason: string;
  onDone: (passed: boolean) => void;
}

export default function WorldSelfieModal({ reason, onDone }: Props) {
  const [stage, setStage] = useState<"scanning" | "passed">("scanning");

  useEffect(() => {
    const t = setTimeout(() => setStage("passed"), 1800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (stage === "passed") {
      const t = setTimeout(() => onDone(true), 900);
      return () => clearTimeout(t);
    }
  }, [stage, onDone]);

  return (
    <div className="fixed inset-0 bg-ink/80 z-50 flex items-center justify-center px-6">
      <div className="bg-paper-bright border border-rule max-w-sm w-full p-6 text-center">
        <p className="mono-tag text-ink-faint mb-4">World Selfie Check</p>
        <div className="mx-auto w-28 h-28 rounded-full border-2 border-ink flex items-center justify-center relative overflow-hidden mb-5">
          {stage === "scanning" ? (
            <div className="w-full h-full bg-paper-dim relative">
              <div className="absolute left-0 right-0 h-0.5 bg-stamp animate-[stampIn_1.8s_linear_infinite]" />
              <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-xs">
                scanning
              </div>
            </div>
          ) : (
            <span className="text-stamp text-3xl">✓</span>
          )}
        </div>
        <p className="text-sm mb-1">{reason}</p>
        <p className="text-xs text-ink-faint">
          {stage === "scanning"
            ? "Hold still — confirming a live human."
            : "Verified. Proof tied to this specific action."}
        </p>
      </div>
    </div>
  );
}
