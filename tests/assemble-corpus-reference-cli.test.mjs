import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const cli = fileURLToPath(new URL("../scripts/assemble-corpus-reference.mjs", import.meta.url));

test("reference outputs tolerate a placeholder marker and reject real or linked worktrees", () => {
  const scratch = mkdtempSync(join(tmpdir(), "satinlore-assembly-"));
  const privateDirectory = join(scratch, "private");
  const repository = join(scratch, "repo");
  const linkedWorktree = join(scratch, "linked");
  const alias = join(scratch, "linked-alias");
  const sourcePath = join(scratch, "source.json");
  const checkpointPath = join(scratch, "checkpoint.json");
  const selectionPath = join(privateDirectory, "selection.json");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = args => execFileSync("git", args, {env, stdio: "pipe"});
  const run = (output, selection = selectionPath) => spawnSync(process.execPath, [cli,
    "--source", sourcePath, "--checkpoint", checkpointPath, "--output", output, "--adjudication-output", selection,
  ], {encoding: "utf8", timeout: 10000});

  try {
    mkdirSync(join(scratch, ".git"));
    mkdirSync(privateDirectory);
    const source = JSON.stringify({works: []});
    writeFileSync(sourcePath, source);
    writeFileSync(checkpointPath, JSON.stringify({sourceBundleSha256: createHash("sha256").update(source).digest("hex"), batches: []}));
    const privateOutput = join(privateDirectory, "reference.json");
    const accepted = run(privateOutput);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.ok(existsSync(privateOutput));

    git(["-c", "init.templateDir=", "init", "--quiet", repository]);
    git(["-C", repository, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
      "-c", "commit.gpgsign=false", "commit", "--allow-empty", "--quiet", "-m", "Fixture"]);
    git(["-C", repository, "worktree", "add", "--detach", "--quiet", linkedWorktree]);
    symlinkSync(linkedWorktree, alias, "junction");
    const nested = join(repository, "nested");
    mkdirSync(join(nested, ".git"), {recursive: true});

    for (const directory of [repository, nested, linkedWorktree, alias]) {
      const deniedPath = join(directory, "reference.json");
      const denied = run(deniedPath);
      assert.equal(denied.status, 1);
      assert.match(denied.stderr, /Write private results outside a Git checkout/u);
      assert.equal(existsSync(deniedPath), false);
    }

    const unwritten = join(privateDirectory, "unwritten.json");
    const deniedSelection = run(unwritten, join(repository, "selection.json"));
    assert.equal(deniedSelection.status, 1);
    assert.equal(existsSync(unwritten), false);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
});
