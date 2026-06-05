import type { DesktopWindowRole } from "../shared/desktop-api";

export function resolveDesktopWindowRole(hash: string): DesktopWindowRole {
  return hash === "#overlay" || hash === "#/overlay" ? "overlay" : "control";
}
