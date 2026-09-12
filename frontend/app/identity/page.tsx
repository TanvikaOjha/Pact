"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toaster";
import { slugify, saveSubnameFor } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import TerminalBlock from "@/components/TerminalBlock";
import WorldSelfieModal from "@/components/WorldSelfieModal";
import Seal from "@/components/Seal";

const STAGES = ["wallet", "ens", "world"] as const;

export default function IdentityPage() {
  const { api, walletAddress, signInDev } = useAuth();
  const { pushToast } = useToast();
  const router = useRouter();
  const [wallet, setWallet] = useState(walletAddress ?? "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [selfie, setSelfie] = useState(false);
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

  function generateWallet() {
    setWallet(privateKeyToAccount(generatePrivateKey()).address);
  }

  async function handleCreate() {
    if (!wallet.trim() || !name.trim()) return;
    setSelfie(true);
  }

  async function handleSelfieDone() {
    setSelfie(false);
    const address = wallet.trim();
    signInDev(address);
    try {
      setStep("Verifying World selfie proof...");
      await api.verifyWorld({ responses: [] });
      setStep("Registering business on-chain...");
      const res = await api.registerBusiness({
        slug,
        proof: { responses: [] },
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
          onDone={() => void handleSelfieDone()}
        />
      )}
      <p className="mono-tag text-ink-mute mb-4">Identity setup</p>
      <h1 className="text-3xl font-medium tracking-[-0.8px] mb-6">Your business on Pact</h1>

      <label className="block text-sm mb-2 text-ink-body">Wallet address</label>
      <div className="flex gap-2 mb-5">
        <input
          className="field-input font-mono text-sm"
          placeholder="0x…"
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          disabled={!!step}
        />
        <button onClick={generateWallet} disabled={!!step} className="btn-ghost text-sm shrink-0">
          New
        </button>
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
      <p className="mono-tag text-accent mb-6">{slug}.pact.eth</p>

      <button
        onClick={() => void handleCreate()}
        disabled={!name.trim() || !wallet.trim() || !!step}
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

      <p className="text-xs text-ink-mute mt-8">
        Dev seam: paste any test wallet or generate one. Privy embedded
        wallets land here — the API already speaks Bearer tokens.
      </p>
    </motion.div>
  );
}
