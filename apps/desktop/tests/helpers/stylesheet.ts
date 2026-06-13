import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cssImportPattern = /@import\s+["']([^"']+)["'];/g;

export function readStylesheetWithImports(entryPath: string, seen = new Set<string>()): string {
  const resolvedPath = resolve(entryPath);

  if (seen.has(resolvedPath)) {
    return "";
  }

  seen.add(resolvedPath);

  const stylesheet = readFileSync(resolvedPath, "utf8").replace(/\r\n/g, "\n");

  return stylesheet.replace(cssImportPattern, (statement, importPath: string) => {
    if (/^(?:https?:|data:)/.test(importPath)) {
      return statement;
    }

    return readStylesheetWithImports(resolve(dirname(resolvedPath), importPath), seen);
  });
}
