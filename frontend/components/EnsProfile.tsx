"use client";

import { useEffect, useState } from "react";
import { readEnsProfile } from "@/lib/ens";

const KEYS = [
  "pact:world-verified",
  "pact:joined",
  "pact:completed-count",
  "pact:dispute-count",
  "pact:total-value",
] as const;

export default function EnsProfile({ name }: { name: string }) {
  const [state, setState] = useState<{
    loading: boolean;
    resolver: string | null;
    records: Record<string, string | null>;
    error: string | null;
  }>({
    loading: true,
    resolver: null,
    records: {},
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    void readEnsProfile(name, KEYS)
      .then((result) => {
        if (cancelled) return;
        setState({
          loading: false,
          resolver: result.resolver,
          records: result.records,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          loading: false,
          resolver: null,
          records: {},
          error: error instanceof Error ? error.message : "ENS read failed",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [name]);

  if (state.loading) {
    return (
      <div className="border border-rule bg-paper-bright p-5 text-sm text-ink-faint">
        Reading live ENS records…
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="border border-danger/30 bg-paper-bright p-5 text-sm">
        <p className="text-danger mb-1">ENS profile unavailable.</p>
        <p className="text-xs text-ink-faint">{state.error}</p>
      </div>
    );
  }

  return (
    <div className="border border-rule bg-paper-bright p-5">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div>
          <p className="mono-tag text-ink-faint">Live ENS identity</p>
          <p className="font-mono text-sm mt-1">{name}</p>
        </div>
        <span className="mono-tag text-stamp">RESOLVED</span>
      </div>

      <div className="space-y-2 text-sm font-mono">
        {KEYS.map((key) => (
          <div key={key} className="flex gap-3">
            <span className="text-ink-faint w-44 shrink-0">{key}</span>
            <span className="break-all">{state.records[key] ?? "(unset)"}</span>
          </div>
        ))}
      </div>

      {state.resolver && (
        <p className="text-xs text-ink-faint mt-4">
          Resolver · <span className="font-mono">{state.resolver}</span>
        </p>
      )}
    </div>
  );
}
