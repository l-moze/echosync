import type { ReactNode } from "react";

export function LauncherRow({
  label,
  value,
  children
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="launcherRow">
      <span>{label}</span>
      <strong>{value}</strong>
      {children ? <div className="launcherRowControl">{children}</div> : null}
    </div>
  );
}
