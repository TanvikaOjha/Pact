interface Props {
  size?: number;
  className?: string;
  tone?: "ink" | "stamp";
}

export default function Seal({ size = 40, className = "", tone = "ink" }: Props) {
  const color = tone === "stamp" ? "#1F5C46" : "#161A1E";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="29"
        fill="none"
        stroke={color}
        strokeWidth="1.4"
      />
      <circle
        cx="32"
        cy="32"
        r="23"
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeDasharray="1.5 4.2"
      />
      <path
        d="M22 20 L22 45 M22 20 L33 20 Q40 20 40 27 Q40 34 33 34 L22 34"
        fill="none"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
