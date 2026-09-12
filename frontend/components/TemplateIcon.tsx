import { TemplateType } from "@/lib/types";

interface Props {
  id: TemplateType;
  size?: number;
  className?: string;
}

const paths: Record<TemplateType, React.ReactNode> = {
  fixed: (
    <>
      <path d="M13 6h16l6 6v30a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
      <path d="M29 6v6h6" />
      <path d="M16 26l5 5 11-13" />
    </>
  ),
  milestone: (
    <>
      <path d="M8 40V14" />
      <path d="M8 40h9v-9H8" />
      <path d="M17 31h9V19h-9" />
      <path d="M26 19h9V8h-9" />
    </>
  ),
  retainer: (
    <>
      <circle cx="24" cy="24" r="9" />
      <path d="M24 15v18M15 24h18" />
      <path d="M35 12a17 17 0 0 1 4 11" />
      <path d="M39 19l2 4-4 1" />
      <path d="M13 36a17 17 0 0 1-4-11" />
      <path d="M9 29l-2-4 4-1" />
    </>
  ),
  "t-and-m": (
    <>
      <circle cx="24" cy="25" r="15" />
      <path d="M24 17v8l6 4" />
      <path d="M18 6h12" />
    </>
  ),
  recurring: (
    <>
      <path d="M11 20a13 13 0 0 1 22-8" />
      <path d="M37 20V9h-11" />
      <path d="M37 28a13 13 0 0 1-22 8" />
      <path d="M11 28v11h11" />
    </>
  ),
  split: (
    <>
      <circle cx="9" cy="24" r="3.4" />
      <circle cx="39" cy="12" r="3.4" />
      <circle cx="39" cy="36" r="3.4" />
      <path d="M12 24h6" />
      <path d="M22 24c3 0 4-8 8-9.6" />
      <path d="M22 24c3 0 4 8 8 9.6" />
    </>
  ),
  custom: (
    <>
      <path d="M24 6l16 8v20l-16 8-16-8V14Z" />
      <path d="M24 6v32M8 14l16 8 16-8" />
    </>
  ),
};

export default function TemplateIcon({ id, size = 28, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[id]}
    </svg>
  );
}
