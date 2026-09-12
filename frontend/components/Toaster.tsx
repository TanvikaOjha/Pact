"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface Toast {
  id: string;
  message: string;
  tone: "accent" | "danger" | "ink";
}

interface ToastShape {
  toasts: Toast[];
  pushToast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastShape | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (message: string, tone: Toast["tone"] = "ink") => {
      counter += 1;
      const id = `toast_${Date.now()}_${counter}`;
      setToasts((list) => [...list, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), 4200),
      );
    },
    [dismissToast],
  );

  const value = useMemo(
    () => ({ toasts, pushToast, dismissToast }),
    [toasts, pushToast, dismissToast],
  );
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastShape {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const toneClass: Record<Toast["tone"], string> = {
  accent: "border-accent/60 text-accent bg-canvas",
  danger: "border-danger/60 text-danger bg-canvas",
  ink: "border-line text-ink bg-canvas-soft",
};

export default function Toaster() {
  const { toasts, dismissToast } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`text-left text-sm border rounded px-4 py-3 animate-fadeUp ${toneClass[t.tone]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
