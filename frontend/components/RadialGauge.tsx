"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

interface Props {
  percent: number;
  size?: number;
  label?: string;
}

export default function RadialGauge({ percent, size = 96, label }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const stroke = 7;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;

  return (
    <div className="flex items-center gap-4">
      <svg ref={ref} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#D9D2BF"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#1F5C46"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: inView ? offset : c }}
          transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="font-serif"
          fontSize={size * 0.24}
          fill="#1B1F24"
        >
          {percent}%
        </text>
      </svg>
      {label && <p className="text-xs text-ink-faint max-w-[7rem]">{label}</p>}
    </div>
  );
}