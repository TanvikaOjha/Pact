// Vendored + adapted from DavidHDev/canvas-ui (MIT + Commons Clause):
// src/lib/ParticleReveal/ParticleReveal.tsx
// https://github.com/DavidHDev/canvas-ui
// Pact adaptation: lint-safe failure flag. Applied ONLY to picker cards
// (monochrome dust suits the single-accent rule); text stays legible.
"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createParticleReveal,
  supportsHtmlInCanvas,
  type ParticleRevealInstance,
  type ParticleRevealOptions,
} from "./ParticleRevealVanilla";

export interface ParticleRevealProps extends ParticleRevealOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const emptySubscribe = () => () => {};

export function ParticleReveal({
  children,
  className,
  style,
  ...options
}: ParticleRevealProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<ParticleRevealInstance | null>(null);
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
    instanceRef.current = createParticleReveal(
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

export type { ParticleRevealInstance, ParticleRevealOptions };

export default ParticleReveal;
