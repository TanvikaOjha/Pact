"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "@/lib/store";
import { slugify } from "@/lib/utils";
import TerminalBlock from "@/components/TerminalBlock";
import Seal from "../../components/Seal";

const STAGES = ["wallet", "ens", "world"] as const;

function stageFromStep(step: string | null): number {
  if (!step) return -1;
  if (step.toLowerCase().includes("wallet")) return 0;
  if (step.toLowerCase().includes("ens")) return 1;
  if (step.toLowerCase().includes("selfie") || step.toLowerCase().includes("world")) return 2;
  return 2;
}

export default function IdentityPage() {
  const { createBusiness, currentBusiness } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState(currentBusiness ?? null);

  const slug = slugify(name || "your-business");
  const activeStage = stageFromStep(step);

  async function handleCreate() {
    if (!name.trim()) return;
    setStep("Starting...");
    const biz = await createBusiness(name, (s) => setStep(s));
    setStep(null);
    setDone(biz);
  }

  if (done) {
    return (
      <div className="max-w-md py-16">
        <p className="mono-tag text-ink-faint mb-4">Identity active</p>
        <motion.div
          className="border border-rule bg-paper-bright p-6 mb-6 relative overflow-hidden"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="absolute -top-2 right-4"
            initial={{ opacity: 0, scale: 2, rotate: -10 }}
            animate={{ opacity: 0.9, scale: 1, rotate: -6 }}
            transition={{ delay: 0.3, duration: 0.5, ease: [0.2, 0.9, 0.25, 1.1] }}
          >
            <Seal size={44} tone="stamp" />
          </motion.div>
          <p className="font-serif text-2xl mb-1">{done.ensSubname}</p>
          <p className="text-sm text-stamp mb-4">World verified ✓</p>
          <TerminalBlock
            records={[
              ["pact:world-verified", done.worldSessionId],
              ["pact:joined", new Date(done.joinedAt).toISOString().slice(0, 10)],
              ["wallet", done.walletAddress],
            ]}
            etherscanLabel="View on Etherscan"
          />
        </motion.div>
        <p className="text-sm text-ink-soft mb-6">
          That ENS subname is yours. Pact can&rsquo;t revoke it — it&rsquo;ll
          outlive this platform. Your engagement history builds here from
          now on.
        </p>
        <button onClick={() => router.push("/templates")} className="btn-primary">
          Start an engagement
        </button>
      </div>
    );
  }

  return (
    <motion.div
      className="max-w-md py-16"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <p className="mono-tag text-ink-faint mb-4">Step 1 of 1</p>
      <h1 className="font-serif text-3xl mb-6">Your business on Pact</h1>

      <label className="block text-sm mb-2">Business name</label>
      <input
        className="field-input mb-1"
        placeholder="e.g. Harbor Studio"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={!!step}
      />
      <p className="mono-tag text-ink-faint mb-6">{slug}.pact.eth</p>

      <button
        onClick={handleCreate}
        disabled={!name.trim() || !!step}
        className="btn-primary w-full"
      >
        {step ? "Working..." : "Create identity"}
      </button>

      <AnimatePresence>
        {step && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4"
          >
            <div className="flex items-center gap-2 mb-2">
              {STAGES.map((s, i) => (
                <div key={s} className="flex-1 h-1 bg-rule overflow-hidden">
                  <motion.div
                    className="h-1 bg-stamp"
                    initial={{ width: 0 }}
                    animate={{ width: i <= activeStage ? "100%" : 0 }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-faint cursor-blink">{step}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-xs text-ink-faint mt-8">
        Email only — Privy creates your embedded wallet behind the scenes.
        No seed phrase, no gas prompt.
      </p>
    </motion.div>
  );
}
