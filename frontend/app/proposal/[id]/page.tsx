"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import VerifyStamp from "../../../components/VerifyStamp";
import { formatUSDC } from "@/lib/utils";
import { templateName } from "../../../lib/templates";

export default function ProposalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { getEngagement, currentBusiness, signAsCounterparty } = useStore();
  const engagement = getEngagement(id);
  const [signing, setSigning] = useState<string | null>(null);

  useEffect(() => {
    if (engagement && engagement.status === "active") {
      router.replace(`/engagement/${engagement.id}`);
    }
    if (engagement && engagement.status === "completed") {
      router.replace(`/engagement/${engagement.id}`);
    }
  }, [engagement, router]);

  if (!engagement) {
    return <div className="py-16">Proposal not found.</div>;
  }

  const isProposer = currentBusiness?.id === engagement.partyAId;
  const records = Object.entries(engagement.fields) as Array<[string, string]>;

  const engagementId = engagement.id;

  async function handleSign() {
    setSigning("Starting...");
    await signAsCounterparty(engagementId, (s) => setSigning(s));
    router.push(`/engagement/${engagementId}`);
  }

  return (
    <div className="py-14 max-w-2xl">
      <p className="mono-tag text-ink-faint mb-2">
        {templateName(engagement.templateType)} · Proposal
      </p>
      <h1 className="font-serif text-3xl mb-2">{engagement.title}</h1>
      <p className="text-ink-soft mb-8">
        {formatUSDC(engagement.totalAmount)} USDC ·{" "}
        {isProposer ? (
          <>proposed to {engagement.partyBSlug}.pact.eth</>
        ) : (
          <>proposed by a counterparty</>
        )}
      </p>

      <div className="mb-6">
        <VerifyStamp
          ensSubname={engagement.ensSubname}
          records={records}
          termsHash={engagement.termsHash}
        />
      </div>

      {isProposer ? (
        <div className="border border-rule bg-paper-bright p-5">
          <p className="text-sm mb-3">
            Waiting on <span className="font-mono">{engagement.partyBSlug}.pact.eth</span> to
            open this link and sign. Nothing is escrowed until they do.
          </p>
          <button onClick={handleSign} disabled={!!signing} className="btn-ghost text-sm">
            {signing ?? `Simulate ${engagement.partyBSlug}.pact.eth opening this link →`}
          </button>
          {signing && <p className="text-xs text-ink-faint mt-2 cursor-blink">{signing}</p>}
        </div>
      ) : (
        <button onClick={handleSign} disabled={!!signing} className="btn-primary">
          {signing ?? "Sign and fund escrow"}
        </button>
      )}
    </div>
  );
}
