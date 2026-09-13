"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import { useAuth } from "@/lib/auth";
import type { WorldProofPayload } from "@/lib/api";

interface Props {
  reason: string;
  onDone: (proof: WorldProofPayload) => void;
  onCancel: () => void;
}

type WorldRpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

export default function WorldSelfieModal({ reason, onDone, onCancel }: Props) {
  const { api } = useAuth();
  const [rpContext, setRpContext] = useState<WorldRpContext | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const appId = useMemo(
    () => (process.env.NEXT_PUBLIC_WLD_APP_ID ?? "") as `app_${string}` | "",
    [],
  );
  const action = process.env.NEXT_PUBLIC_WLD_ACTION ?? "pact-selfie-check";
  const environment = (process.env.NEXT_PUBLIC_WLD_ENVIRONMENT ?? "production") as
    | "production"
    | "staging"
    | "sandbox";
  const missingConfig =
    appId === "" ||
    process.env.NEXT_PUBLIC_WLD_ACTION === undefined ||
    process.env.NEXT_PUBLIC_WLD_ENVIRONMENT === undefined;

  useEffect(() => {
    if (missingConfig) return;

    let active = true;
    async function loadContext() {
      try {
        const ctx = await api.worldRpContext();
        if (!active) return;
        setRpContext({
          rp_id: ctx.rp_id,
          nonce: ctx.nonce,
          created_at: ctx.created_at,
          expires_at: ctx.expires_at,
          signature: ctx.signature,
        });
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? `World ID is unavailable: ${err.message}`
            : "World ID is unavailable. Configure the server-side signing key.",
        );
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadContext();
    return () => {
      active = false;
    };
  }, [api, missingConfig]);

  if (missingConfig) {
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 bg-canvas/85 z-50 flex items-center justify-center px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="bg-canvas rounded-md border border-line max-w-sm w-full p-6 text-center"
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <p className="mono-tag text-ink-mute mb-4">World Selfie Check</p>
            <p className="text-sm mb-3">{reason}</p>
            <p className="text-xs text-danger mb-4">
              World ID is not configured. Set the three `NEXT_PUBLIC_WLD_*`
              variables before starting a verification.
            </p>
            <button onClick={onCancel} className="btn-ghost text-sm w-full">
              Close
            </button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-canvas/85 z-50 flex items-center justify-center px-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-canvas rounded-md border border-line max-w-sm w-full p-6 text-center"
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <p className="mono-tag text-ink-mute mb-4">World Selfie Check</p>
          <div className="mx-auto w-28 h-28 rounded-full border-2 border-ink flex items-center justify-center relative overflow-hidden mb-5">
            <div className="w-full h-full bg-canvas-soft flex items-center justify-center text-ink-mute text-xs">
              {isLoading ? "loading" : "proof"}
            </div>
          </div>
          <p className="text-sm mb-1">{reason}</p>
          <p className="text-xs text-ink-mute mb-3">
            Complete the World ID check to verify you are a unique human.
          </p>

          {error ? (
            <div className="space-y-3">
              <p className="text-xs text-danger">{error}</p>
              <button onClick={onCancel} className="btn-ghost text-sm w-full">
                Close
              </button>
            </div>
          ) : appId && rpContext ? (
            <IDKitRequestWidget
              open={widgetOpen}
              onOpenChange={(nextOpen) => {
                setWidgetOpen(nextOpen);
                if (!nextOpen) onCancel();
              }}
              app_id={appId}
              action={action}
              rp_context={rpContext}
              environment={environment}
              allow_legacy_proofs={false}
              preset={selfieCheckLegacy({ signal: `pact:${action}` })}
              onSuccess={(result) => {
                // Safety: the IDKit payload is a JSON object the backend forwards as-is.
                const proof = result as unknown as WorldProofPayload;
                onDone(proof);
              }}
              onError={(errorCode) => {
                setError(`World ID request failed (${errorCode}).`);
              }}
            />
          ) : (
            <div className="text-xs text-ink-mute">Preparing World ID…</div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
