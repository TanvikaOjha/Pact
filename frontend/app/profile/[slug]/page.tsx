"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { formatUSDC } from "@/lib/utils";
import { templateName } from "@/lib/templates";
import type { ReputationResponse } from "@/lib/api";
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
  const { api } = useAuth();
  const [profile, setProfile] = useState<ReputationResponse | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(await api.getReputation(`${slug}.pact.eth`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [api, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="py-16">
        <p className="text-ink-body">No business found at {slug}.pact.eth yet.</p>
      </div>
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
