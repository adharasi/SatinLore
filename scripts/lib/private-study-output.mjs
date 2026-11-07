import {spawnSync} from "node:child_process";
import {realpath} from "node:fs/promises";
import {basename, dirname, join} from "node:path";

export async function privateOutput(path) {
  const parent = await realpath(dirname(path));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = spawnSync("git", ["-C", parent, "rev-parse", "--is-inside-work-tree"],
    {encoding: "utf8", env: {...env, LC_ALL: "C"}, timeout: 5000, maxBuffer: 8192, windowsHide: true});
  if (git.error || git.status === 0 || !git.stderr?.includes("not a git repository")) {
    throw new TypeError("Use a private output location outside Git.");
  }
  return join(parent, basename(path));
}
