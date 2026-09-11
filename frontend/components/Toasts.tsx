"use client";

import { useStore } from "@/lib/store";

const toneClass: Record<string, string> = {
  stamp: "border-stamp text-stamp bg-stamp-soft",
  ember: "border-ember text-ember bg-ember-soft",
  ink: "border-ink text-ink bg-paper-bright",
};

export default function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`text-left text-sm border px-4 py-3 animate-fadeUp shadow-none ${toneClass[t.tone]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
