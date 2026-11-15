/**
 * Mobile icon set — 22px stroke icons drawn on a 24px grid.
 * Emoji are kept for agent identity (the roster is a cast of characters),
 * never for navigation chrome: emoji render differently on every handset and
 * cannot inherit colour or stroke weight.
 */
type IconProps = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
});

export function IconCounter({ className, size = 22 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 9.5 12 3.5l8.5 6" />
      <path d="M5 9v10.5h14V9" />
      <path d="M9.5 19.5v-5h5v5" />
    </svg>
  );
}

export function IconBolt({ className, size = 22 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />
    </svg>
  );
}

export function IconBook({ className, size = 22 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18.5v-14Z" />
      <path d="M8.5 3v18" />
      <path d="M12 8h4M12 12h4" />
    </svg>
  );
}

export function IconUsers({ className, size = 22 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.1 2.5-5.2 5.5-5.2s5.5 2.1 5.5 5.2" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.5 14.9c2 .6 3.5 2.4 3.5 5.1" />
    </svg>
  );
}

export function IconSpeaker({ className, size = 22, muted }: IconProps & { muted?: boolean }) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9.5h3l4.5-3.8v12.6L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
      {muted ? (
        <path d="m16 9.5 4.5 5M20.5 9.5l-4.5 5" />
      ) : (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}

export function IconMic({ className, size = 22 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </svg>
  );
}

export function IconClose({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconCheck({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.2}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function IconBackspace({ className, size = 22 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 5h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7Z" />
      <path d="m12.5 9.5 5 5M17.5 9.5l-5 5" />
    </svg>
  );
}

export function IconArrowRight({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 12h15" />
      <path d="m13.5 6 6 6-6 6" />
    </svg>
  );
}

export function IconPlay({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={1.6}>
      <path d="M8 4.8v14.4l11-7.2L8 4.8Z" />
    </svg>
  );
}
