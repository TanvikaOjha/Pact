// Vendored + adapted from DavidHDev/canvas-ui (MIT + Commons Clause):
// src/lib/DecryptReveal/DecryptReveal.tsx
// https://github.com/DavidHDev/canvas-ui
// Pact adaptation: lint-safe failure flag; theme applied by callers
// (turquoise cipher #2DD4BF on warm charcoal #2b2622).
// Without html-in-canvas support the children render as plain HTML —
// progressive enhancement only, never load-bearing.
"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createDecryptReveal,
  supportsHtmlInCanvas,
  type DecryptRevealInstance,
  type DecryptRevealOptions,
} from "./DecryptRevealVanilla";

export interface DecryptRevealProps extends DecryptRevealOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const emptySubscribe = () => () => {};

export function DecryptReveal({
  children,
  className,
  style,
  ...options
}: DecryptRevealProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<DecryptRevealInstance | null>(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);

  const supported = useSyncExternalStore(
    emptySubscribe,
    supportsHtmlInCanvas,
    () => false,
  );
  const native = supported && !failed;

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createDecryptReveal(
      { source, content, output },
      initialOptions,
    );
    if (native && !instanceRef.current) {
      const timer = setTimeout(() => setFailed(true), 0);
      return () => {
        clearTimeout(timer);
        instanceRef.current?.destroy();
        instanceRef.current = null;
      };
    }
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions, native]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <canvas
        ref={sourceRef}
        // @ts-expect-error experimental html-in-canvas attribute
        layoutsubtree="true"
        suppressHydrationWarning
        style={
          native
            ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
            : { display: "none" }
        }
      >
        {native ? (
          <div
            ref={contentRef}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "auto",
            }}
          >
            {children}
          </div>
        ) : null}
      </canvas>
      {!native ? (
        <div
          ref={contentRef}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "auto",
          }}
        >
          {children}
        </div>
      ) : null}
      <canvas
        ref={outputRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export type { DecryptRevealInstance, DecryptRevealOptions };

export default DecryptReveal;
