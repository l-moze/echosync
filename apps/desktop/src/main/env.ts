import fs from "node:fs";
import path from "node:path";

export type LoadDesktopEnvironmentOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  mainDir?: string;
};

export function loadDesktopEnvironment({
  cwd = process.cwd(),
  env = process.env,
  mainDir = __dirname
}: LoadDesktopEnvironmentOptions = {}) {
  const loadedFiles: string[] = [];
  for (const filePath of resolveDesktopEnvPaths(cwd, mainDir)) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const loadedKeys = parseDotEnvText(fs.readFileSync(filePath, "utf8"), env);
    if (loadedKeys.length > 0) {
      loadedFiles.push(filePath);
    }
  }
  return loadedFiles;
}

export function parseDotEnvText(text: string, env: NodeJS.ProcessEnv = process.env) {
  const loadedKeys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }
    const [key, value] = parsed;
    if (env[key]) {
      continue;
    }
    env[key] = value;
    loadedKeys.push(key);
  }
  return loadedKeys;
}

function resolveDesktopEnvPaths(cwd: string, mainDir: string) {
  return Array.from(new Set([
    path.resolve(mainDir, "../../../../.env"),
    path.resolve(cwd, "../../.env"),
    path.resolve(cwd, ".env")
  ]));
}

function parseDotEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }
  const key = trimmed.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  return [key, unquoteDotEnvValue(trimmed.slice(equalsIndex + 1).trim())];
}

function unquoteDotEnvValue(value: string) {
  const withoutInlineComment = value.startsWith("\"") || value.startsWith("'")
    ? value
    : value.replace(/\s+#.*$/, "").trim();
  if (
    (withoutInlineComment.startsWith("\"") && withoutInlineComment.endsWith("\"")) ||
    (withoutInlineComment.startsWith("'") && withoutInlineComment.endsWith("'"))
  ) {
    return withoutInlineComment.slice(1, -1);
  }
  return withoutInlineComment;
}
