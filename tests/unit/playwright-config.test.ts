import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const decoder = new TextDecoder();

function resolvePlaywrightBaseUrl(e2ePort?: string): string {
  const env = { ...process.env };
  if (e2ePort === undefined) {
    delete env.E2E_PORT;
  } else {
    env.E2E_PORT = e2ePort;
  }

  const proc = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      "import config from './playwright.config.ts'; console.log(config.use?.baseURL ?? '')",
    ],
    {
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stderr = decoder.decode(proc.stderr).trim();
  expect(proc.exitCode, stderr).toBe(0);

  return decoder.decode(proc.stdout).trim();
}

test("playwright baseURL is stable across process boundaries", () => {
  const runs = Array.from({ length: 5 }, () => resolvePlaywrightBaseUrl());
  expect(new Set(runs).size).toBe(1);
});

test("playwright baseURL honors E2E_PORT override", () => {
  expect(resolvePlaywrightBaseUrl("5123")).toBe("http://127.0.0.1:5123");
});
