export type ToolbarIconName =
  | "settings"
  | "lock"
  | "unlock"
  | "pin"
  | "target"
  | "more"
  | "close"
  | "mic"
  | "system"
  | "power"
  | "minimize"
  | "model";

export function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {name === "settings" ? (
        <>
          <circle cx="12" cy="12" r="3.1" {...common} />
          <path d="M19 13.4v-2.8l-2.1-.5c-.2-.6-.4-1.1-.7-1.6l1.1-1.8-2-2-1.8 1.1c-.5-.3-1-.5-1.6-.7L11.4 3H8.6l-.5 2.1c-.6.2-1.1.4-1.6.7L4.7 4.7l-2 2 1.1 1.8c-.3.5-.5 1-.7 1.6l-2.1.5v2.8l2.1.5c.2.6.4 1.1.7 1.6l-1.1 1.8 2 2 1.8-1.1c.5.3 1 .5 1.6.7l.5 2.1h2.8l.5-2.1c.6-.2 1.1-.4 1.6-.7l1.8 1.1 2-2-1.1-1.8c.3-.5.5-1 .7-1.6Z" {...common} />
        </>
      ) : null}
      {name === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2.3" {...common} />
          <path d="M8.2 10V7.5a3.8 3.8 0 0 1 7.6 0V10" {...common} />
        </>
      ) : null}
      {name === "unlock" ? (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2.3" {...common} />
          <path d="M8.2 10V7.5a3.8 3.8 0 0 1 6.7-2.4" {...common} />
        </>
      ) : null}
      {name === "pin" ? <path d="M14.8 3.8 20.2 9l-3.1 1.1-3.8 3.8.4 4.2L12.4 19l-3.5-3.5-4.1-4.1 1.1-1.3 4.2.4 3.8-3.8Z M9 15l-4 4" {...common} /> : null}
      {name === "target" ? (
        <>
          <circle cx="12" cy="12" r="7.5" {...common} />
          <circle cx="12" cy="12" r="2.6" {...common} />
          <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" {...common} />
        </>
      ) : null}
      {name === "more" ? (
        <>
          <circle cx="6" cy="12" r="1.4" fill="currentColor" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" />
        </>
      ) : null}
      {name === "close" ? <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" {...common} /> : null}
      {name === "minimize" ? <path d="M6 12h12" {...common} /> : null}
      {name === "mic" ? (
        <>
          <rect x="9" y="3.5" width="6" height="10" rx="3" {...common} />
          <path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.8V21M8.8 21h6.4" {...common} />
        </>
      ) : null}
      {name === "system" ? (
        <>
          <rect x="4" y="5" width="16" height="11" rx="2" {...common} />
          <path d="M9 20h6M12 16v4M7.5 9.2h9" {...common} />
        </>
      ) : null}
      {name === "power" ? (
        <>
          <path d="M12 3.5v8" {...common} />
          <path d="M7.4 6.8a7.2 7.2 0 1 0 9.2 0" {...common} />
        </>
      ) : null}
      {name === "model" ? (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" {...common} />
          <path d="M8 9h8M8 13h5M16.5 13.5l1.3 1.3M18 12.2v2.6" {...common} />
        </>
      ) : null}
    </svg>
  );
}
