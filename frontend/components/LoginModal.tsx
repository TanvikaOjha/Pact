"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";

interface Props {
  onClose: () => void;
  /** Fires once a wallet address becomes available, by whichever method. */
  onSignedIn?: (wallet: string) => void;
}

export default function LoginModal({ onClose, onSignedIn }: Props) {
  const { connectWithPrivy, signInManual, walletAddress } = useAuth();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  function handlePrivy() {
    connectWithPrivy();
    // Privy's own modal takes over from here; close ours so they don't stack.
    onClose();
  }

  function handleManualSubmit() {
    const error = signInManual(manualValue);
    if (error) {
      setManualError(error);
      return;
    }
    onSignedIn?.(manualValue.trim());
    onClose();
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-canvas/85 z-50 flex items-center justify-center px-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-canvas rounded-md border border-line max-w-sm w-full p-6"
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mono-tag text-ink-mute mb-1">Sign in</p>
          <h2 className="text-xl mb-5 text-ink">Get started on Pact</h2>

          {privyConfigured ? (
            <button onClick={handlePrivy} className="btn-primary w-full mb-3">
              Continue with email or wallet
            </button>
          ) : (
            <p className="text-xs text-danger mb-3">
              Privy isn&rsquo;t configured (missing NEXT_PUBLIC_PRIVY_APP_ID) —
              only the manual option below is available.
            </p>
          )}
          {privyConfigured && (
            <p className="text-xs text-ink-mute mb-5">
              Opens Privy&rsquo;s sign-in — pick email (we create a wallet for
              you) or connect an existing wallet like MetaMask.
            </p>
          )}

          <div className="border-t border-line pt-4">
            {!manualOpen ? (
              <button
                onClick={() => setManualOpen(true)}
                className="text-xs text-ink-mute hover:text-ink transition-colors underline underline-offset-2"
              >
                Advanced: enter a wallet address manually
              </button>
            ) : (
              <div>
                <label className="block text-xs mb-2 text-ink-body">
                  Wallet address
                  <span className="text-ink-mute"> — read-only/demo, no signature required</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="field-input font-mono text-sm"
                    placeholder="0x…"
                    value={manualValue}
                    onChange={(e) => {
                      setManualValue(e.target.value);
                      setManualError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                  />
                  <button onClick={handleManualSubmit} className="btn-ghost text-sm shrink-0">
                    Use
                  </button>
                </div>
                {manualError && <p className="text-xs text-danger mt-2">{manualError}</p>}
                <p className="text-xs text-ink-mute mt-2">
                  This proves nothing on its own — the backend only accepts it
                  in dev/demo mode, and any write action still needs a real
                  signature.
                </p>
              </div>
            )}
          </div>

          {walletAddress && (
            <p className="text-xs text-ink-mute mt-5">
              Already signed in as <span className="font-mono">{walletAddress}</span>.
            </p>
          )}

          <button onClick={onClose} className="btn-ghost text-sm w-full mt-5">
            Cancel
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
