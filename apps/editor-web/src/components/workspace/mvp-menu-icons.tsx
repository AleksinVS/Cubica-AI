import React, { type SVGProps } from "react";

export type MvpMenuIconName = "chat" | "editor" | "drawing" | "play" | "pause" | "scenario" | "rules" | "pin" | "drag";

type IconProps = SVGProps<SVGSVGElement> & {
  readonly name: MvpMenuIconName;
};

/** Small, dependency-free line icons used by the editor's floating menu. */
export function MvpMenuIcon({ name, ...props }: IconProps) {
  const common: SVGProps<SVGSVGElement> = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: "false" as const,
    "aria-hidden": true
  };

  switch (name) {
    case "chat":
      return (
        <svg {...common} {...props}>
          <path d="M5 4.5h14v12H9l-4 3v-15Z" />
          <path d="M8.5 8h7M8.5 11.5h5" />
        </svg>
      );
    case "editor":
      return (
        <svg {...common} {...props}>
          <path d="m5.2 3.5 13.2 13.2-6.1-.9-2.8 5.1-2.5-1.4 2.8-5.1L5.2 3.5Z" />
          <path d="m8.6 14.4 3.7 2.1" />
        </svg>
      );
    case "drawing":
      return (
        <svg {...common} {...props}>
          <path d="m5 16 9.7-9.7a2 2 0 0 1 2.8 2.8L7.8 18.8 4 20l1-4Z" />
          <path d="m13.4 7.6 3 3M4 20l3.8-1.2" />
        </svg>
      );
    case "play":
      return (
        <svg {...common} {...props}>
          <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common} {...props}>
          <path d="M8 5.5v13M16 5.5v13" strokeWidth="2.5" />
        </svg>
      );
    case "scenario":
      return (
        <svg {...common} {...props}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.2 2M9 3.9 7.2 2.8M15 3.9l1.8-1.1" />
        </svg>
      );
    case "rules":
      return (
        <svg {...common} {...props}>
          <path d="m6 4 12 1.5v14L6 18V4Z" />
          <path d="M6 4 4.5 5.2v13.5L18 20M9 8l5.5.7M9 11.3l4 .5" />
        </svg>
      );
    case "pin":
      return (
        <svg {...common} {...props}>
          <path d="m8 4 8 1.5-1.3 4 2.5 3-5.1-.4-1.5 7.2-1.4-.2.1-7.3-4.5-2 3.2-2.7L8 4Z" />
        </svg>
      );
    case "drag":
      return (
        <svg {...common} {...props}>
          <path d="M5 12h14M8 8l-3 4 3 4M16 8l3 4-3 4" />
        </svg>
      );
  }
}
