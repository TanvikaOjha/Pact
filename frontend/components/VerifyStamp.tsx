"use client";

import { useState } from "react";
import { readEnsProfile } from "@/lib/ens";

interface Props {
  ensSubname: string;
  records: Array<[string, string]>;
  termsHash: string;
}

type Phase = "idle" | "resolving" | "verified" | "mismatch" | "error";

export default function VerifyStamp({ ensSubname, records: localRecords, termsHash }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [chainRecords, setChainRecords] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (phase === "resolving" || phase === "verified") return;
    setPhase("resolving");
    setError(null);

    try {
      const keys = [...localRecords.map(([key]) => key), "pact:terms-hash", "pact:status"];
      const result = await readEnsProfile(ensSubname, keys);
      const actualHash = result.records["pact:terms-hash"]?.toLowerCase() ?? "";
      const expectedHash = termsHash.toLowerCase();

      setChainRecords(result.records);
      setPhase(actualHash !== expectedHash ? "mismatch" : "verified");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ENS resolution failed");
      setPhase("error");
    }
  }

  const displayedRecords =
    phase === "verified" || phase === "mismatch"
      ? localRecords.map(([key]) => [key, chainRecords[key] ?? "(unset)"] as [string, string])
      : localRecords;

  return (
    <div className="plate rounded overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line gap-4">
        <div>
          <p className="mono-tag text-ink-mute">Live ENS resolution — no backend call</p>
          <p className="mono-tag text-accent mt-1">{ensSubname}</p>
        </div>
        {phase === "idle" && (
          <button onClick={() => void run()} className="btn-ghost text-sm shrink-0">
            Verify on ENS
          </button>
        )}
        {phase === "resolving" && (
          <span className="mono-tag text-ink-mute cursor-blink">resolving</span>
        )}
        {phase === "mismatch" && (
          <span className="mono-tag text-danger">mismatch</span>
        )}
        {phase === "error" && (
          <button onClick={() => void run()} className="btn-ghost text-sm shrink-0">
            Retry
          </button>
        )}
      </div>

      {(phase === "verified" || phase === "mismatch") && (
        <div className="relative px-4 py-4">
          <div className="space-y-1.5">
            {displayedRecords.map(([k, v]) => (
              <div key={k} className="flex gap-3 text-sm font-mono">
                <span className="text-ink-mute shrink-0 w-40 truncate">{k}</span>
                <span className="break-all text-ink-body">{v}</span>
              </div>
            ))}
            <div className="flex gap-3 text-sm font-mono pt-2 border-t border-line mt-2">
              <span className="text-ink-mute shrink-0 w-40">pact:terms-hash</span>
              <span className="break-all text-ink-body">{chainRecords["pact:terms-hash"] ?? "(unset)"}</span>
            </div>
            <div className="flex gap-3 text-sm font-mono">
              <span className="text-ink-mute shrink-0 w-40">pact:status</span>
              <span className="break-all text-ink-body">{chainRecords["pact:status"] ?? "(unset)"}</span>
            </div>
          </div>

          {phase === "verified" && (
            <>
              <div
                className="pointer-events-none absolute -top-3 right-4 select-none animate-stampIn"
                aria-hidden="true"
              >
                <div className="border-[3px] border-accent text-accent px-3 py-1 -rotate-6 font-mono text-sm tracking-widest opacity-90">
                  VERIFIED
                </div>
              </div>
              <p className="text-sm text-accent mt-3">
                ENS terms hash matches the terms shown before signing.
              </p>
            </>
          )}

          {phase === "mismatch" && (
            <p className="text-sm text-danger mt-3">
              ENS contains a different terms hash. Do not sign these terms.
            </p>
          )}
        </div>
      )}

      {phase === "error" && (
        <p className="px-4 py-4 text-sm text-danger">
          {error ?? "Unable to resolve ENS records."}
        </p>
      )}
    </div>
  );
}
