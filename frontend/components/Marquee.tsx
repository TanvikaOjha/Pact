interface Row {
  a: string;
  b: string;
  tpl: string;
  value: string;
  flag: string;
}

export default function Marquee({ rows }: { rows: Row[] }) {
  const doubled = [...rows, ...rows];
  return (
    <div className="overflow-hidden border-y border-rule bg-paper-bright">
      <div className="marquee-track flex w-max">
        {doubled.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-6 py-3 border-r border-rule text-sm whitespace-nowrap"
          >
            <span className="font-mono">{f.a}</span>
            <span className="text-ink-faint">↔</span>
            <span className="font-mono">{f.b}</span>
            <span className="text-ink-faint">{f.tpl}</span>
            <span className="font-mono">{f.value}</span>
            <span className="text-stamp">{f.flag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
