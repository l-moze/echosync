import type { DesktopWindowRole } from "../shared/desktop-api";

export function resolveDesktopWindowRole(hash: string): DesktopWindowRole {
  if (hash === "#overlay" || hash === "#/overlay") {
    return "overlay";
  }
  if (hash === "#subtitle-style" || hash === "#/subtitle-style") {
    return "subtitle-style";
  }
  return "control";
}
