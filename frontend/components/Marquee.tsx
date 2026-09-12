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
    <div className="overflow-hidden border-y border-line bg-canvas-soft">
      <div className="marquee-track flex w-max">
        {doubled.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-6 py-3 border-r border-line text-sm whitespace-nowrap"
          >
            <span className="font-mono text-ink-body">{f.a}</span>
            <span className="text-ink-mute">↔</span>
            <span className="font-mono text-ink-body">{f.b}</span>
            <span className="text-ink-mute">{f.tpl}</span>
            <span className="font-mono text-ink-body">{f.value}</span>
            <span className="text-accent">{f.flag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
