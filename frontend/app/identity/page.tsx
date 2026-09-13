"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toaster";
import { slugify, saveSubnameFor } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import TerminalBlock from "@/components/TerminalBlock";
import WorldSelfieModal from "@/components/WorldSelfieModal";
import LoginModal from "@/components/LoginModal";
import Seal from "@/components/Seal";
import { truncateMid } from "@/lib/utils";
import type { WorldProofPayload } from "@/lib/api";

const STAGES = ["wallet", "ens", "world"] as const;

export default function IdentityPage() {
  const { api, walletAddress, ready, authMethod, signOut } = useAuth();
  const { pushToast } = useToast();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [selfie, setSelfie] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [done, setDone] = useState<{
    ensSubname: string;
    walletAddress: string;
    worldSessionId: string;
    email: string;
  } | null>(null);

  const slug = slugify(name || "your-business");

  function activeStage(): number {
    if (!step) return -1;
    const s = step.toLowerCase();
    if (s.includes("wallet")) return 0;
    if (s.includes("ens") || s.includes("register")) return 1;
    return 2;
  }

  async function handleCreate() {
    if (!walletAddress || !name.trim()) return;
    setSelfie(true);
  }

  async function handleSelfieDone(proof: WorldProofPayload) {
    setSelfie(false);
    try {
      // World proofs are single-use. Registration verifies and persists this
      // proof, so do not submit it to /world/verify first.
      setStep("Verifying World selfie and registering business...");
      const res = await api.registerBusiness({
        slug,
        proof,
        email: email.trim() === "" ? undefined : email.trim(),
      });
      saveSubnameFor(res.walletAddress, res.ensSubname);
      setStep(null);
      setDone({
        ensSubname: res.ensSubname,
        walletAddress: res.walletAddress,
        worldSessionId: res.worldSessionId,
        email: email.trim(),
      });
      pushToast("Identity active — business registered.", "accent");
    } catch (err) {
      setStep(null);
      pushToast(
        err instanceof ApiError
          ? `Registration failed (${err.code ?? err.status}).`
          : "Registration failed.",
        "danger",
      );
    }
  }

  if (done) {
    return (
      <div className="max-w-md py-16">
        <p className="mono-tag text-ink-mute mb-4">Identity active</p>
        <motion.div
          className="plate rounded p-6 mb-6 relative overflow-hidden"
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
            <Seal size={44} tone="accent" />
          </motion.div>
          <p className="text-2xl mb-1 text-ink">{done.ensSubname}</p>
          <p className="text-sm text-accent mb-4">World verified ✓</p>
          <TerminalBlock
            records={[
              ["pact:world-verified", done.worldSessionId],
              ["wallet", done.walletAddress],
              ["status", "pending_onchain"],
            ]}
            footnote="mint the subname + fund to activate on-chain"
          />
        </motion.div>
        <p className="text-sm text-ink-body mb-6">
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
      {selfie && (
        <WorldSelfieModal
          reason="Activating your business identity"
          onDone={(proof) => void handleSelfieDone(proof)}
          onCancel={() => setSelfie(false)}
        />
      )}
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      <p className="mono-tag text-ink-mute mb-4">Identity setup</p>
      <h1 className="text-3xl font-medium tracking-[-0.8px] mb-6">Your business on Pact</h1>

      {!ready ? (
        <p className="text-sm text-ink-mute">Loading…</p>
      ) : !walletAddress ? (
        <div className="plate rounded p-5 mb-6">
          <p className="text-sm text-ink-body mb-3">
            Sign in first — with email, a connected wallet, or a manual
            address — then come back to register your business.
          </p>
          <button onClick={() => setLoginOpen(true)} className="btn-primary text-sm">
            Sign in
          </button>
        </div>
      ) : (
        <>
          <label className="block text-sm mb-2 text-ink-body">Wallet</label>
          <div className="flex items-center justify-between gap-2 mb-5 field-input font-mono text-sm">
            <span>{truncateMid(walletAddress, 8, 6)}</span>
            <span className="flex items-center gap-2 shrink-0">
              {authMethod === "manual" && (
                <span className="mono-tag text-ink-mute">read-only</span>
              )}
              <button
                onClick={signOut}
                className="text-xs text-ink-mute hover:text-ink transition-colors"
                disabled={!!step}
              >
                Change
              </button>
            </span>
          </div>

          <label className="block text-sm mb-2 text-ink-body">Email (for notifications)</label>
          <input
            className="field-input mb-5"
            placeholder="you@studio.co"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!!step}
          />

          <label className="block text-sm mb-2 text-ink-body">Business name</label>
          <input
            className="field-input mb-1"
            placeholder="e.g. Harbor Studio"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!step}
          />
          <p className="mono-tag text-accent mb-6">{slug}.pact-hack.eth</p>
          {name.trim() !== "" && slug.length < 3 && (
            <p className="text-xs text-danger -mt-4 mb-6">
              Use at least 3 letters or numbers for the business name.
            </p>
          )}

          <button
            onClick={() => void handleCreate()}
            disabled={!name.trim() || slug.length < 3 || !!step}
            className="btn-primary w-full"
          >
            {step ? "Working..." : "Create identity"}
          </button>
        </>
      )}

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
                <div key={s} className="flex-1 h-1 bg-line overflow-hidden">
                  <motion.div
                    className="h-1 bg-accent"
                    initial={{ width: 0 }}
                    animate={{ width: i <= activeStage() ? "100%" : 0 }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-mute cursor-blink">{step}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
