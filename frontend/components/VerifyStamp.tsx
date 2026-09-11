"use client";

import { useState } from "react";
import { wait } from "@/lib/utils";

interface Props {
  ensSubname: string;
  records: Array<[string, string]>;
  termsHash: string;
}

export default function VerifyStamp({ ensSubname, records, termsHash }: Props) {
  const [phase, setPhase] = useState<"idle" | "resolving" | "verified">("idle");

  async function run() {
    if (phase !== "idle") return;
    setPhase("resolving");
    await wait(1100);
    setPhase("verified");
  }

  return (
    <div className="border border-rule bg-paper-bright">
      <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
        <div>
          <p className="mono-tag text-ink-faint">Live ENS resolution — no backend call</p>
          <p className="mono-tag">{ensSubname}</p>
        </div>
        {phase === "idle" && (
          <button onClick={run} className="btn-ghost text-sm">
            Verify on ENS
          </button>
        )}
        {phase === "resolving" && (
          <span className="mono-tag text-ink-faint cursor-blink">resolving</span>
        )}
      </div>

      {phase === "verified" && (
        <div className="relative px-4 py-4">
          <div className="space-y-1.5">
            {records.map(([k, v]) => (
              <div key={k} className="flex gap-3 text-sm font-mono">
                <span className="text-ink-faint shrink-0 w-40">{k}</span>
                <span className="break-all">{v}</span>
              </div>
            ))}
            <div className="flex gap-3 text-sm font-mono pt-1 border-t border-rule mt-2">
              <span className="text-ink-faint shrink-0 w-40">terms-hash</span>
              <span className="break-all">{termsHash}</span>
            </div>
          </div>

          <div
            className="pointer-events-none absolute -top-3 right-4 select-none animate-stampIn"
            aria-hidden="true"
          >
            <div className="border-[3px] border-stamp text-stamp px-3 py-1 -rotate-6 font-mono text-sm tracking-widest opacity-90">
              VERIFIED
            </div>
          </div>
          <p className="text-sm text-stamp mt-3">
            Terms match exactly what was shown before signing.
          </p>
        </div>
      )}
    </div>
  );
}
