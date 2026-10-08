import { describe, expect, it } from "vitest";
import { PM2_LISTEN_TIMEOUT_MS, PROCESS_DRAIN_MS } from "../../server/boot-ready.js";
import { extractPm2ProcessList } from "../../scripts/check-production-session-secret.js";
import {
  API_PORT,
  STANDBY_PORT,
  apiReloadArgs,
  apiStartArgs,
  chooseReload,
  describeApi,
  inheritedAppEnv,
  readApiProcess,
  runReload,
  standbyStartArgs,
  waitForHttpOk,
  waitForProcessDrain,
  type ReloadIo,
} from "../../scripts/reload-api.js";

const SECRET = "super-secret-session-value";

function apiProc(pm2Env: Record<string, unknown>): unknown {
  return { name: "api", pm2_env: pm2Env };
}

function io(overrides: Partial<ReloadIo> & Pick<ReloadIo, "readPm2Json">): { calls: string[]; reload: ReloadIo } {
  const calls: string[] = [];
  const reload = Object.assign({
    log: (line: string) => calls.push(`log:${line}`),
    readPm2Json: overrides.readPm2Json,
    reloadApi: async () => { calls.push("reload"); },
    patchNginx: async () => { calls.push("nginx"); },
    startStandby: async () => { calls.push("startStandby"); },
    waitHealthy: async (port: number) => { calls.push(`healthy:${port}`); },
    stopApi: async () => { calls.push("stopApi"); },
    waitDrain: async () => { calls.push("waitDrain"); },
    deleteApi: async () => { calls.push("deleteApi"); },
    startApi: async () => { calls.push("startApi"); },
    stopStandby: async () => { calls.push("stopStandby"); },
    deleteStandby: async () => { calls.push("deleteStandby"); },
    save: async () => { calls.push("save"); },
  }, overrides);
  return { calls, reload };
}

describe("chooseReload", () => {
  it("reloads only a cluster worker that will wait out the warm", () => {
    expect(chooseReload(null)).toBe("handoff");
    expect(chooseReload({ execMode: "fork_mode", waitReady: true, listenTimeout: PM2_LISTEN_TIMEOUT_MS })).toBe("handoff");
    expect(chooseReload({ execMode: "cluster_mode", waitReady: false, listenTimeout: PM2_LISTEN_TIMEOUT_MS })).toBe("handoff");
    expect(chooseReload({ execMode: "cluster_mode", waitReady: true, listenTimeout: 15_000 })).toBe("handoff");
    expect(chooseReload({ execMode: "cluster_mode", waitReady: true, listenTimeout: 0 })).toBe("handoff");
    expect(chooseReload({
      execMode: "cluster_mode",
      waitReady: true,
      listenTimeout: PM2_LISTEN_TIMEOUT_MS,
    })).toBe("reload");
  });

  it("treats a missing listen_timeout as too short", () => {
    const view = readApiProcess([apiProc({ exec_mode: "cluster_mode", wait_ready: true })]);
    expect(view).toEqual({ execMode: "cluster_mode", waitReady: true, listenTimeout: 0 });
    expect(chooseReload(view)).toBe("handoff");
  });
});

describe("runReload", () => {
  const forkList = JSON.stringify([apiProc({
    exec_mode: "fork_mode",
    wait_ready: false,
    listen_timeout: 3000,
    env: { SESSION_SECRET: SECRET, NODE_APP_INSTANCE: "0", axm_monitor: "skip" },
  })]);

  it("logs the live mode and keeps the old process until standby is healthy", async () => {
    const { calls, reload } = io({ readPm2Json: () => forkList });
    await expect(runReload(reload)).resolves.toBe("handoff");
    expect(calls).toEqual([
      "log:api process: exec_mode=fork_mode wait_ready=false listen_timeout=3000",
      "log:api reload via handoff",
      "nginx",
      "startStandby",
      `healthy:${STANDBY_PORT}`,
      "stopApi",
      "waitDrain",
      "deleteApi",
      "startApi",
      `healthy:${API_PORT}`,
      "stopStandby",
      "waitDrain",
      "deleteStandby",
      "save",
    ]);
    expect(calls.join("\n")).not.toContain(SECRET);
  });

  it("does not stop the current api when standby never becomes healthy", async () => {
    const { calls, reload } = io({
      readPm2Json: () => forkList,
      waitHealthy: async (port) => {
        calls.push(`healthy:${port}`);
        throw new Error("standby down");
      },
    });
    await expect(runReload(reload)).rejects.toThrow(/standby down/);
    expect(calls).not.toContain("stopApi");
    expect(calls).not.toContain("stopStandby");
    expect(calls).toContain("deleteStandby");
    expect(calls.some((line) => line.includes("leaving api serving"))).toBe(true);
    expect(calls.some((line) => line.includes("via handoff"))).toBe(true);
  });

  it("leaves standby in place when the new api fails", async () => {
    const { calls, reload } = io({
      readPm2Json: () => forkList,
      startApi: async () => {
        calls.push("startApi");
        throw new Error("api failed");
      },
    });
    await expect(runReload(reload)).rejects.toThrow(/api failed/);
    expect(calls).toContain("stopApi");
    expect(calls).not.toContain("stopStandby");
    expect(calls).not.toContain("save");
    expect(calls.some((line) => line.includes("leaving api-standby"))).toBe(true);
  });

  it("reloads in place once cluster wait_ready can cover the warm", async () => {
    const raw = JSON.stringify([apiProc({
      exec_mode: "cluster_mode",
      wait_ready: true,
      listen_timeout: PM2_LISTEN_TIMEOUT_MS,
      env: { SESSION_SECRET: SECRET },
    })]);
    const { calls, reload } = io({ readPm2Json: () => raw });
    await expect(runReload(reload)).resolves.toBe("reload");
    expect(calls).toEqual([
      `log:api process: exec_mode=cluster_mode wait_ready=true listen_timeout=${PM2_LISTEN_TIMEOUT_MS}`,
      "log:api reload via reload",
      "reload",
    ]);
    expect(calls.join("\n")).not.toContain(SECRET);
  });
});

describe("reload env and pm2 args", () => {
  it("copies the app env and drops cluster bookkeeping", () => {
    const procs = extractPm2ProcessList(JSON.stringify([apiProc({
      exec_mode: "fork_mode",
      env: {
        SESSION_SECRET: SECRET,
        NODE_APP_INSTANCE: "0",
        DATABASE_URL: "postgres://db",
        axm_monitor: "no",
      },
    })]));
    expect(procs).not.toBeNull();
    const env = inheritedAppEnv((procs?.[0] as { pm2_env: unknown }).pm2_env);
    expect(env.SESSION_SECRET).toBe(SECRET);
    expect(env.DATABASE_URL).toBe("postgres://db");
    expect(env.NODE_APP_INSTANCE).toBeUndefined();
    expect(env.axm_monitor).toBeUndefined();
    const described = describeApi(readApiProcess(procs ?? []));
    expect(described).not.toContain(SECRET);
  });

  it("reloads without --update-env and starts cluster with the warm timeout", () => {
    expect(apiReloadArgs()).toEqual(["reload", "api"]);
    expect(apiReloadArgs().join(" ")).not.toContain("update-env");
    expect(apiStartArgs()).toEqual(["start", "ecosystem.config.cjs", "--only", "api"]);
    expect(standbyStartArgs()).toContain("--wait-ready");
    expect(standbyStartArgs()).toContain(String(PM2_LISTEN_TIMEOUT_MS));
    expect(standbyStartArgs()).toContain("--name");
    expect(standbyStartArgs()).toContain("api-standby");
  });

  it("polls until robots.txt returns 200", async () => {
    let calls = 0;
    await waitForHttpOk(API_PORT, {
      budgetMs: 1_000,
      sleep: async () => {},
      fetchImpl: async () => {
        calls++;
        if (calls < 2) throw new Error("connect ECONNREFUSED");
        return { ok: true, status: 200 };
      },
    });
    expect(calls).toBe(2);
  });

  it("waits the full drain even if the port is already closed", async () => {
    const slept: number[] = [];
    await waitForProcessDrain(async (ms) => { slept.push(ms); });
    expect(slept).toEqual([PROCESS_DRAIN_MS]);
    expect(PROCESS_DRAIN_MS).toBe(8_000);
  });
});
