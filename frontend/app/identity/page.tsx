"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { slugify } from "@/lib/utils";
import TerminalBlock from "../../components/TerminalBlock";

export default function IdentityPage() {
  const { createBusiness, currentBusiness } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState(currentBusiness ?? null);

  const slug = slugify(name || "your-business");

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
        <div className="border border-rule bg-paper-bright p-6 mb-6">
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
        </div>
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
    <div className="max-w-md py-16">
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
      <p className="mono-tag text-ink-faint mb-6">
        {slug}.pact.eth
      </p>

      <button
        onClick={handleCreate}
        disabled={!name.trim() || !!step}
        className="btn-primary w-full"
      >
        {step ?? "Create identity"}
      </button>

      {step && (
        <p className="text-xs text-ink-faint mt-3 cursor-blink">{step}</p>
      )}

      <p className="text-xs text-ink-faint mt-8">
        Email only — Privy creates your embedded wallet behind the scenes.
        No seed phrase, no gas prompt.
      </p>
    </div>
  );
}
