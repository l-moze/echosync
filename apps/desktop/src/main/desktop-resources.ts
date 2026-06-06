import path from "node:path";

export const APP_ICON_RESOURCE_PATH = path.join("resources", "icons", "app.ico");

export type DesktopResourcePathInput = {
  isPackaged: boolean;
  mainDir: string;
  resourcesPath: string;
};

export function resolveDesktopResourcePath(input: DesktopResourcePathInput, relativePath: string) {
  const baseDir = input.isPackaged ? input.resourcesPath : path.resolve(input.mainDir, "../..");
  return path.join(baseDir, relativePath);
}

export function resolveAppIconPath(input: DesktopResourcePathInput) {
  return resolveDesktopResourcePath(input, APP_ICON_RESOURCE_PATH);
}
