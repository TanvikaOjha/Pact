"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/Toaster";
import {
  loadProposalSnapshot,
  saveEngagement,
  type LocalEngagement,
  type ProposalSnapshot,
} from "@/lib/utils";
import { ApiError, type GetProposalResponse } from "@/lib/api";
import VerifyStamp from "@/components/VerifyStamp";
import TemplateIcon from "@/components/TemplateIcon";
import { formatUSDC } from "@/lib/utils";
import { templateName } from "@/lib/templates";
import type { TemplateType } from "@/lib/types";

export default function ProposalPage() {
  const { id: token } = useParams<{ id: string }>();
  const router = useRouter();
  const { api, walletAddress, signInDev } = useAuth();
  const { pushToast } = useToast();
  const [proposal, setProposal] = useState<GetProposalResponse | null>(null);
  const [snapshot, setSnapshot] = useState<ProposalSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [altWallet, setAltWallet] = useState("");

  const load = useCallback(async () => {
    setSnapshot(loadProposalSnapshot(token));
    try {
      const res = await api.getProposal(token);
      setProposal(res);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Proposal unavailable (${err.code ?? err.status}).`
          : "Proposal unavailable.",
      );
    }
  }, [api, token]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (error) {
    return (
      <div className="py-16 max-w-2xl">
        <p className="text-ink-body">{error}</p>
        <p className="text-sm text-ink-mute mt-2">
          Links expire after 14 days, or the proposal was already accepted.
        </p>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="py-16 max-w-2xl">
        <p className="mono-tag text-ink-mute cursor-blink">loading proposal</p>
      </div>
    );
  }

  const terms = proposal.terms;
  const templateId = (["fixed", "milestone", "retainer", "t-and-m", "recurring", "split"][
    terms.templateType - 1
  ] ?? "custom") as TemplateType;
  const isProposer =
    walletAddress !== null &&
    snapshot !== null &&
    snapshot.proposerWallet.toLowerCase() === walletAddress.toLowerCase();

  const records: Array<[string, string]> = [
    ...Object.entries(terms.fields),
    ["pact:terms-hash", terms.termsHash],
  ];

  async function handleAccept() {
    if (!walletAddress) return;
    setAccepting(true);
    try {
      const res = await api.acceptProposal(token);
      const record: LocalEngagement = {
        id: res.engagementId,
        onChainId: "offchain",
        ensSubname: res.ensSubname,
        templateType: terms.templateType,
        templateName: snapshot?.templateName ?? templateName(templateId),
        title: terms.title,
        scope: terms.scope,
        acceptanceCriteria: terms.acceptanceCriteria,
        totalAmount: terms.totalAmount,
        termsHash: terms.termsHash,
        status: "ACTIVE",
        counterparty: snapshot?.counterparty ?? "",
        proposerWallet: snapshot?.proposerWallet ?? "",
        milestones: terms.milestones.map((m) => ({
          index: m.index,
          name: m.name,
          deliverable: m.deliverable,
          due: m.due,
          amount: m.amount,
          worldRequired: m.worldRequired,
          submittedAt: null,
          releasedAt: null,
          disputed: false,
          late: false,
          evidenceHash: null,
        })),
        proposalToken: token,
        visibility: snapshot?.visibility ?? "public",
        updatedAt: new Date().toISOString(),
      };
      saveEngagement(record);
      pushToast("Counter-signed — engagement mirror created.", "accent");
      router.push(`/engagement/${res.engagementId}`);
    } catch (err) {
      pushToast(
        err instanceof ApiError ? `Accept failed (${err.code ?? err.status}).` : "Accept failed.",
        "danger",
      );
    } finally {
      setAccepting(false);
    }
  }

  return (
    <motion.div
      className="py-14 max-w-2xl"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 border border-line rounded flex items-center justify-center text-accent shrink-0">
          <TemplateIcon id={templateId} size={18} />
        </div>
        <p className="mono-tag text-ink-mute">
          {templateName(templateId)} · Proposal
        </p>
      </div>
      <h1 className="text-3xl font-medium tracking-[-0.8px] mb-2 text-ink">{terms.title}</h1>
      <p className="text-ink-body mb-8">
        {formatUSDC(terms.totalAmount)} USDC · proposed by{" "}
        <span className="font-mono text-sm">{proposal.proposer?.ensSubname ?? "unknown"}</span>
      </p>

      <div className="mb-6">
        <VerifyStamp
          ensSubname={proposal.proposer?.ensSubname ?? ""}
          records={records}
          termsHash={terms.termsHash}
        />
      </div>

      {!walletAddress ? (
        <div className="plate rounded p-5">
          <p className="text-sm text-ink-body mb-3">
            Sign in with a wallet to counter-sign this proposal.
          </p>
          <div className="flex gap-2">
            <input
              className="field-input font-mono text-sm"
              placeholder="0x…"
              value={altWallet}
              onChange={(e) => setAltWallet(e.target.value)}
            />
            <button
              onClick={() => altWallet.trim() && signInDev(altWallet.trim())}
              className="btn-primary text-sm shrink-0"
            >
              Sign in
            </button>
          </div>
        </div>
      ) : isProposer ? (
        <div className="plate rounded p-5">
          <p className="text-sm text-ink-body">
            Waiting on the counterparty to open this link and sign. Share the
            URL — nothing moves until they do. If that&rsquo;s you on another
            wallet, sign in with it instead.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void handleAccept()} disabled={accepting} className="btn-primary">
            {accepting ? "Accepting..." : "Sign and fund escrow"}
          </button>
          <span className="text-xs text-ink-mute">
            as {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
          </span>
        </div>
      )}
    </motion.div>
  );
}
