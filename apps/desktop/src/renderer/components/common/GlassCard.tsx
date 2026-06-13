import type { ReactNode } from "react";

export function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`glassCard ${className}`}>
      {children}
    </div>
  );
}
