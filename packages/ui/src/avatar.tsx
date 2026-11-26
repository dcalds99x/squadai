import { ACCESSORIES, type AvatarSpec, HAIR_STYLES, MOUTHS } from "@squadai/core";

export type Presence = "working" | "thinking" | "free";

const PRESENCE_COLORS: Record<Presence, string> = {
  working: "#16A34A",
  thinking: "#F59E0B",
  free: "#9AA0B8",
};

export interface AvatarProps {
  spec: AvatarSpec;
  /** Used for the accessible label. */
  name: string;
  size?: number;
  presence?: Presence;
  /** How the presence is read out ("working"). Components carry no copy, so the app translates it. */
  presenceLabel?: string;
  /** Draws a ring so overlapping avatars stay distinct. */
  ring?: string;
  /** Hide from screen readers when the name is already written next to it. */
  decorative?: boolean;
}

export function Avatar({
  spec,
  name,
  size = 40,
  presence,
  presenceLabel,
  ring,
  decorative = false,
}: AvatarProps) {
  const dot = Math.max(8, Math.round(size * 0.26));
  const label = presence && presenceLabel ? `${name}, ${presenceLabel}` : name;
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <circle
          cx="24"
          cy="24"
          r={ring ? 23 : 24}
          fill={spec.background}
          stroke={ring}
          strokeWidth={ring ? 2 : 0}
        />
        <path d="M11 44c2-6 7-9 13-9s11 3 13 9a24 24 0 0 1-26 0z" fill={spec.shirt} />
        <circle cx="24" cy="24" r="10" fill={spec.skin} />
        <path d={HAIR_STYLES[spec.hair]} fill={spec.hairColor} />
        <circle cx="20" cy="25" r="1.4" fill="#1B1D2A" />
        <circle cx="28" cy="25" r="1.4" fill="#1B1D2A" />
        <path
          d={MOUTHS[spec.mouth]}
          stroke="#1B1D2A"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        {spec.accessory !== "none" && (
          <path
            d={ACCESSORIES[spec.accessory]}
            stroke={spec.accessoryColor}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </svg>
      {presence && (
        <span
          className="absolute rounded-full border-2 border-white"
          style={{
            width: dot,
            height: dot,
            right: -1,
            bottom: -1,
            background: PRESENCE_COLORS[presence],
          }}
        />
      )}
    </span>
  );
}

export interface AvatarStackProps {
  people: { name: string; spec: AvatarSpec; presence?: Presence; presenceLabel?: string }[];
  size?: number;
}

export function AvatarStack({ people, size = 32 }: AvatarStackProps) {
  return (
    <span className="inline-flex items-center">
      {people.map((p, i) => (
        <span key={p.name} style={{ marginLeft: i === 0 ? 0 : -size * 0.2 }}>
          <Avatar
            spec={p.spec}
            name={p.name}
            size={size}
            presence={p.presence}
            presenceLabel={p.presenceLabel}
            ring="#FFFFFF"
          />
        </span>
      ))}
    </span>
  );
}
