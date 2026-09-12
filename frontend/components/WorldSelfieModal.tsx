"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  reason: string;
  onDone: (passed: boolean) => void;
}

export default function WorldSelfieModal({ reason, onDone }: Props) {
  const [stage, setStage] = useState<"scanning" | "passed">("scanning");

  useEffect(() => {
    const t = setTimeout(() => setStage("passed"), 1800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (stage === "passed") {
      const t = setTimeout(() => onDone(true), 900);
      return () => clearTimeout(t);
    }
  }, [stage, onDone]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-ink/80 z-50 flex items-center justify-center px-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-paper-bright border border-rule max-w-sm w-full p-6 text-center"
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <p className="mono-tag text-ink-faint mb-4">World Selfie Check</p>
          <div className="mx-auto w-28 h-28 rounded-full border-2 border-ink flex items-center justify-center relative overflow-hidden mb-5">
            {stage === "scanning" ? (
              <div className="w-full h-full bg-paper-dim relative">
                <motion.div
                  className="absolute left-0 right-0 h-0.5 bg-stamp"
                  initial={{ top: "10%" }}
                  animate={{ top: ["10%", "85%", "10%"] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                  className="absolute inset-2 rounded-full border border-stamp/40"
                  animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.2, 0.6] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-xs">
                  scanning
                </div>
              </div>
            ) : (
              <motion.span
                className="text-stamp text-3xl"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, ease: [0.2, 0.9, 0.25, 1.1] }}
              >
                ✓
              </motion.span>
            )}
          </div>
          <p className="text-sm mb-1">{reason}</p>
          <p className="text-xs text-ink-faint">
            {stage === "scanning"
              ? "Hold still — confirming a live human."
              : "Verified. Proof tied to this specific action."}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
