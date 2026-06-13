import type { ReactNode } from "react";

export function StyleSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="styleSection">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
