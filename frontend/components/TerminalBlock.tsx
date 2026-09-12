interface Props {
  title?: string;
  subtitle?: string;
  records: Array<[string, string]>;
  footnote?: string;
}

export default function TerminalBlock({ title, subtitle, records, footnote }: Props) {
  return (
    <div className="terminal">
      {(title || subtitle) && (
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-4">
          <div>
            {title && <p className="text-sm text-ink">{title}</p>}
            {subtitle && <p className="mono-tag text-ink-mute mt-1">{subtitle}</p>}
          </div>
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-line" />
            <span className="w-2.5 h-2.5 rounded-full bg-line" />
            <span className="w-2.5 h-2.5 rounded-full bg-accent" />
          </span>
        </div>
      )}
      <div className="px-4 py-3 space-y-1.5">
        {records.map(([k, v]) => (
          <div key={k} className="flex gap-3 text-sm font-mono">
            <span className="text-ink-mute shrink-0 w-40 truncate">{k}</span>
            <span className="break-all text-ink-body">
              <span className="text-accent mr-2" aria-hidden="true">›</span>
              {v}
            </span>
          </div>
        ))}
      </div>
      {footnote && (
        <p className="px-4 pb-3 font-mono text-xs text-ink-mute">{footnote}</p>
      )}
    </div>
  );
}
