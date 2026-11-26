/** Tiny visuals for the Home pulse: read in a glance, explained on hover. */

export function Sparkbars({ values, label }: { values: number[]; label: string }) {
  const peak = Math.max(1, ...values);
  return (
    <svg
      width="84"
      height="28"
      viewBox="0 0 84 28"
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      {values.map((v, i) => {
        const h = v === 0 ? 2 : Math.max(4, Math.round((v / peak) * 26));
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7-day series, order is identity
            key={i}
            x={i * 12}
            y={28 - h}
            width="8"
            height={h}
            rx="2"
            fill={i === values.length - 1 ? "#5B4CF0" : "#C9C2FF"}
          />
        );
      })}
    </svg>
  );
}

export function Ring({ value, label }: { value: number | null; label: string }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  const filled = value === null ? 0 : Math.max(0, Math.min(1, value)) * c;
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      role="img"
      aria-label={label}
      className="shrink-0 -rotate-90"
    >
      <circle cx="16" cy="16" r={r} fill="none" stroke="#ECEAFE" strokeWidth="5" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke={value !== null && value < 0.5 ? "#F59E0B" : "#16A34A"}
        strokeWidth="5"
        strokeDasharray={`${filled} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Meter({ value, label }: { value: number | null; label: string }) {
  const pct = value === null ? 0 : Math.min(100, Math.round(value * 100));
  const color = pct >= 100 ? "#A61B1B" : pct >= 80 ? "#F59E0B" : "#5B4CF0";
  return (
    <div
      role="img"
      aria-label={label}
      className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[#EEF0F6]"
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
