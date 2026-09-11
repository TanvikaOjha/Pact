interface Props {
  title?: string;
  subtitle?: string;
  records: Array<[string, string]>;
  etherscanLabel?: string;
}

export default function TerminalBlock({ title, subtitle, records, etherscanLabel }: Props) {
  return (
    <div className="border border-rule bg-paper-bright">
      {(title || subtitle) && (
        <div className="px-4 py-3 border-b border-rule flex items-center justify-between">
          <div>
            {title && <p className="text-sm">{title}</p>}
            {subtitle && <p className="mono-tag text-ink-faint">{subtitle}</p>}
          </div>
          {etherscanLabel && (
            <span className="mono-tag text-slate">{etherscanLabel} ↗</span>
          )}
        </div>
      )}
      <div className="px-4 py-3 space-y-1.5">
        {records.map(([k, v]) => (
          <div key={k} className="flex gap-3 text-sm font-mono">
            <span className="text-ink-faint shrink-0 w-40">{k}</span>
            <span className="break-all">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
