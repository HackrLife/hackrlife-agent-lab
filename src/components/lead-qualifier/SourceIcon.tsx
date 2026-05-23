import type { IconKey } from "@/lib/leadQualifierData";

/**
 * Minimal line icons (24x24, 1.6 stroke), dependency-free, keyed to IconKey.
 */
export function SourceIcon({
  icon,
  className = "h-[18px] w-[18px]",
}: {
  icon: IconKey;
  className?: string;
}) {
  const c = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (icon) {
    case "receipt":
      return (
        <svg {...c}>
          <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
          <path d="M8 7h8M8 11h8M8 15h5" />
        </svg>
      );
    case "headset":
      return (
        <svg {...c}>
          <path d="M4 13a8 8 0 0 1 16 0" />
          <rect x="3" y="13" width="4" height="6" rx="1.5" />
          <rect x="17" y="13" width="4" height="6" rx="1.5" />
          <path d="M20 19a3 3 0 0 1-3 3h-3" />
        </svg>
      );
    case "store":
      return (
        <svg {...c}>
          <path d="M3 9 4.5 4h15L21 9" />
          <path d="M4 9v11h16V9" />
          <path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
          <path d="M9 20v-5h6v5" />
        </svg>
      );
    case "affiliate":
      return (
        <svg {...c}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <path d="M7.7 7.8 10.5 16M16.3 7.8 13.5 16M8.5 6h7" />
        </svg>
      );
    case "users":
      return (
        <svg {...c}>
          <circle cx="7" cy="8" r="3" />
          <circle cx="17" cy="8" r="3" />
          <path d="M2 20a5 5 0 0 1 10 0M12 20a5 5 0 0 1 10 0" />
        </svg>
      );
    case "phone":
      return (
        <svg {...c}>
          <path d="M5 4h3l1.5 4.5L7.5 10a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z" />
        </svg>
      );
    case "play":
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 9v6l5-3z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "chat":
      return (
        <svg {...c}>
          <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
          <path d="M8.5 11h7M8.5 14h4" />
        </svg>
      );
    case "social":
      return (
        <svg {...c}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "form":
      return (
        <svg {...c}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h4" />
        </svg>
      );
    default:
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}
