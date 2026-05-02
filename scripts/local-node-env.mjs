import { existsSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_NODE_VERSION = "22.22.2";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function getRepoRoot() {
  return REPO_ROOT;
}

export function getLocalNodeDir(repoRoot = REPO_ROOT) {
  return resolve(repoRoot, ".limcode", "tmp", `node-v${LOCAL_NODE_VERSION}-win-x64`);
}

export function getLocalNodeExecutable(repoRoot = REPO_ROOT) {
  return resolve(getLocalNodeDir(repoRoot), "node.exe");
}

export function hasLocalNode(repoRoot = REPO_ROOT) {
  return process.platform === "win32" && existsSync(getLocalNodeExecutable(repoRoot));
}

function normalizePathSegment(segment) {
  return segment.replace(/[\\/]+$/, "").toLowerCase();
}

export function prependDirectoryToPath(pathValue, directory) {
  if (!directory) {
    return pathValue ?? "";
  }

  const normalizedDirectory = normalizePathSegment(directory);
  const segments = (pathValue ?? "").split(delimiter).filter(Boolean);
  const remainingSegments = segments.filter((segment) => normalizePathSegment(segment) !== normalizedDirectory);
  return [directory, ...remainingSegments].join(delimiter);
}

export function createLocalNodeEnv(baseEnv = process.env, repoRoot = REPO_ROOT) {
  if (!hasLocalNode(repoRoot)) {
    return { ...baseEnv };
  }

  const nodeDir = getLocalNodeDir(repoRoot);
  const currentPath = baseEnv.Path ?? baseEnv.PATH ?? "";
  const nextPath = prependDirectoryToPath(currentPath, nodeDir);

  return {
    ...baseEnv,
    Path: nextPath,
    PATH: nextPath,
  };
}

export function describeLocalNode(repoRoot = REPO_ROOT) {
  return {
    available: hasLocalNode(repoRoot),
    directory: getLocalNodeDir(repoRoot),
    executable: getLocalNodeExecutable(repoRoot),
    version: LOCAL_NODE_VERSION,
  };
}
