"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { loadEngagements } from "@/lib/utils";
import { TEMPLATES, CUSTOM_TEMPLATE } from "@/lib/templates";
import TemplateIcon from "@/components/TemplateIcon";
import RevealOnScroll from "@/components/RevealOnScroll";
import { ParticleReveal } from "@/components/canvas/ParticleReveal";

export default function TemplatePicker() {
  const { walletAddress, ready } = useAuth();
  const router = useRouter();
  const engagements = useMemo(() => {
    if (!walletAddress) return [];
    return Object.values(loadEngagements())
      .filter((e) => e.proposerWallet.toLowerCase() === walletAddress.toLowerCase())
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [walletAddress]);

  useEffect(() => {
    if (ready && !walletAddress) router.replace("/identity");
  }, [ready, walletAddress, router]);

  if (!ready || !walletAddress) return null;

  return (
    <div className="py-14">
      <p className="mono-tag text-accent mb-2">Proposal → sign → fund → deliver → release</p>
      <h1 className="text-3xl font-medium tracking-[-0.8px] mb-8">Start an engagement</h1>

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {TEMPLATES.map((t, i) => (
          <RevealOnScroll key={t.id} delay={i * 0.06} className="h-full">
            <Link href={`/templates/${t.id}`} className="block h-full">
              <ParticleReveal
                className="h-full rounded"
                background="#383330"
                radius={320}
                aberration={0}
                bend={20}
                drift={0.4}
                scatter={12}
              >
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ duration: 0.15 }}
                className="plate rounded p-5 h-full"
              >
                <div className="w-10 h-10 flex items-center justify-center border border-line rounded mb-4 text-accent">
                  <TemplateIcon id={t.id} size={22} />
                </div>
                <p className="mb-2 text-ink">{t.name}</p>
                <p className="text-sm text-ink-body mb-4">{t.useCase}</p>
                <ul className="text-xs text-ink-mute space-y-1">
                  {t.bullets.map((b) => (
                    <li key={b}>› {b}</li>
                  ))}
                </ul>
              </motion.div>
              </ParticleReveal>
            </Link>
          </RevealOnScroll>
        ))}
      </div>

      <RevealOnScroll delay={0.24}>
        <Link href={`/templates/${CUSTOM_TEMPLATE.id}`} className="block">
          <motion.div
            whileHover={{ y: -3 }}
            transition={{ duration: 0.15 }}
            className="plate rounded p-5 text-center flex items-center justify-center gap-3"
          >
            <TemplateIcon id="custom" size={20} className="text-ink-mute" />
            <div>
              <p className="text-ink">Build something custom →</p>
              <p className="text-sm text-ink-body mt-1">
                A six-question guided flow for the other ~10%.
              </p>
            </div>
          </motion.div>
        </Link>
      </RevealOnScroll>

      {engagements.length > 0 && (
        <div className="mt-14 pt-8 border-t border-line">
          <p className="text-sm text-ink-mute mb-4">Your engagements</p>
          {engagements.map((e) => (
            <Link
              key={e.id}
              href={e.status === "PROPOSED" ? `/proposal/${e.proposalToken}` : `/engagement/${e.id}`}
              className="registry-row py-3 flex items-center gap-4 text-sm hover:bg-canvas-soft px-2"
            >
              <span className="w-40 truncate text-ink">{e.title}</span>
              <span className="font-mono text-xs text-ink-mute w-44 truncate">
                {e.ensSubname}
              </span>
              <span className="text-ink-mute w-24 capitalize text-xs">{e.status.toLowerCase()}</span>
              <span className="font-mono ml-auto text-ink-body">
                ${e.totalAmount.toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
