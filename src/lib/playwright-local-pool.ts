import { mkdir, mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";

import type { BrowserContext } from "playwright";

import { getRuntimeEnv } from "@/lib/env";

type PoolTask<T> = (context: BrowserContext, workerId: string) => Promise<T>;

interface LocalPlaywrightPoolOptions {
  maxWorkers: number;
  idleMs: number;
  headless: boolean;
  channel?: string;
  executablePath?: string;
  launchTimeoutMs: number;
  profileBaseDir: string;
}

class LocalBrowserWorker {
  readonly id: string;

  private readonly options: LocalPlaywrightPoolOptions;
  private contextPromise: Promise<BrowserContext> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private profileDir: string | null = null;

  busy = false;

  constructor(id: string, options: LocalPlaywrightPoolOptions) {
    this.id = id;
    this.options = options;
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async createContext() {
    await mkdir(this.options.profileBaseDir, { recursive: true });
    const profileDir = await mkdtemp(
      path.join(this.options.profileBaseDir, `${this.id}-`)
    );
    this.profileDir = profileDir;

    const { chromium } = await import("playwright");
    const launchOptions = {
      headless: this.options.headless,
      ...(this.options.executablePath
        ? { executablePath: this.options.executablePath }
        : this.options.channel
          ? { channel: this.options.channel }
          : {}),
      serviceWorkers: "block",
      ignoreHTTPSErrors: true,
      timeout: this.options.launchTimeoutMs,
      ...(process.platform === "linux" ? { chromiumSandbox: false } : {}),
      args:
        process.platform === "linux"
          ? ["--disable-dev-shm-usage", "--no-sandbox"]
          : ["--disable-dev-shm-usage"]
    } as const;

    try {
      return await chromium.launchPersistentContext(profileDir, launchOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[AlmaTrace] Local Playwright launch failed", {
        workerId: this.id,
        headless: this.options.headless,
        channel: this.options.channel,
        executablePath: this.options.executablePath,
        error: message
      });

      if (process.platform === "darwin" && !this.options.executablePath) {
        console.warn(
          "[AlmaTrace] Falling back to bundled Chromium because Chrome channel launch failed."
        );
        return chromium.launchPersistentContext(profileDir, {
          ...launchOptions,
          channel: "chromium"
        });
      }

      throw error;
    }
  }

  async ensureContext() {
    this.clearIdleTimer();

    if (!this.contextPromise) {
      this.contextPromise = this.createContext();
    }

    return this.contextPromise;
  }

  scheduleIdleShutdown() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.busy) {
        return;
      }

      void this.dispose();
    }, this.options.idleMs);
  }

  async dispose() {
    this.clearIdleTimer();

    const context = await this.contextPromise?.catch(() => null);
    this.contextPromise = null;

    if (context) {
      await context.close().catch(() => undefined);
    }

    if (this.profileDir) {
      await rm(this.profileDir, { recursive: true, force: true }).catch(
        () => undefined
      );
      this.profileDir = null;
    }
  }
}

export class LocalPlaywrightPool {
  private readonly options: LocalPlaywrightPoolOptions;
  private readonly workers: LocalBrowserWorker[] = [];
  private readonly waiters: Array<(worker: LocalBrowserWorker) => void> = [];

  constructor(options: LocalPlaywrightPoolOptions) {
    this.options = options;
  }

  private createWorker() {
    const worker = new LocalBrowserWorker(
      `worker-${this.workers.length + 1}`,
      this.options
    );
    this.workers.push(worker);
    return worker;
  }

  private async acquireWorker(): Promise<LocalBrowserWorker> {
    const idleWorker = this.workers.find((worker) => !worker.busy);
    if (idleWorker) {
      idleWorker.busy = true;
      return idleWorker;
    }

    if (this.workers.length < this.options.maxWorkers) {
      const worker = this.createWorker();
      worker.busy = true;
      return worker;
    }

    return new Promise((resolve) => {
      this.waiters.push((worker) => {
        worker.busy = true;
        resolve(worker);
      });
    });
  }

  private releaseWorker(worker: LocalBrowserWorker) {
    const next = this.waiters.shift();
    if (next) {
      next(worker);
      return;
    }

    worker.busy = false;
    worker.scheduleIdleShutdown();
  }

  async run<T>(task: PoolTask<T>) {
    const worker = await this.acquireWorker();

    try {
      const context = await worker.ensureContext();
      return await task(context, worker.id);
    } finally {
      this.releaseWorker(worker);
    }
  }

  async disposeAll() {
    await Promise.all(this.workers.map((worker) => worker.dispose()));
  }
}

let localPlaywrightPool: LocalPlaywrightPool | null = null;

function buildPoolOptions(): LocalPlaywrightPoolOptions {
  const runtimeEnv = getRuntimeEnv();

  return {
    maxWorkers: Math.max(1, runtimeEnv.localBrowserMaxWorkers),
    idleMs: Math.max(1_000, runtimeEnv.localBrowserIdleMs),
    headless: runtimeEnv.localBrowserHeadless,
    channel: runtimeEnv.playwrightBrowserChannel,
    executablePath: runtimeEnv.playwrightExecutablePath,
    launchTimeoutMs: Math.max(3_000, runtimeEnv.playwrightLaunchTimeoutMs),
    profileBaseDir:
      runtimeEnv.localBrowserProfileBaseDir ||
      path.join(os.tmpdir(), "almatrace-browser-workers")
  };
}

export function getLocalPlaywrightPool() {
  if (!localPlaywrightPool) {
    localPlaywrightPool = new LocalPlaywrightPool(buildPoolOptions());
  }

  return localPlaywrightPool;
}
