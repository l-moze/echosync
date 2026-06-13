import type { ReactNode } from "react";

export function GradientButton({
  children,
  onClick,
  className = "",
  type = "button"
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} className={`gradientButton ${className}`}>
      {children}
    </button>
  );
}
