import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const ANSI = /\u001b\[[0-9;]*m/g;

/** Vite's dev server treats port 0 as unset and falls back to the config port. */
export function viteOriginFromLog(log: string): string | null {
  const match = log.replace(ANSI, "").match(/Local:\s+(https?:\/\/127\.0\.0\.1:\d+)/);
  if (!match?.[1]) return null;
  return match[1].replace(/\/$/, "");
}

/** Bind port 0 and release it. Callers pass the number to a server that cannot bind 0 itself. */
export function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    const fail = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        fail(new Error("free-port probe did not bind a TCP port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

export async function startViteOnFreePort(options: {
  cwd: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{ child: ChildProcess; origin: string; port: number }> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await findFreePort();
    try {
      return await launchVite(port, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("vite did not start");
}

function launchVite(
  port: number,
  options: { cwd: string; args?: string[]; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ child: ChildProcess; origin: string; port: number }> {
  const child = spawn(process.execPath, [
    resolve(options.cwd, "node_modules/vite/bin/vite.js"),
    ...(options.args ?? []),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ], {
    cwd: options.cwd,
    env: { ...process.env, BROWSER: "none", NO_COLOR: "1", FORCE_COLOR: "0", ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`vite did not start on ${port}\n${logs.slice(-800)}`));
    }, options.timeoutMs ?? 20_000);
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`vite exited ${code ?? "null"} on ${port}\n${logs.slice(-800)}`));
    };
    const onData = (chunk: Buffer) => {
      logs += chunk.toString();
      const origin = viteOriginFromLog(logs);
      if (!origin) return;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolveReady({ child, origin, port: Number(new URL(origin).port) });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}
