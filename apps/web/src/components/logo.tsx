export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#5B4CF0" />
        <circle cx="11" cy="14" r="3" fill="#FFFFFF" />
        <circle cx="21" cy="14" r="3" fill="#FFFFFF" />
        <path
          d="M10 21c3 3 9 3 12 0"
          stroke="#FFFFFF"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-xl font-bold tracking-tight">squadai</span>
    </span>
  );
}
