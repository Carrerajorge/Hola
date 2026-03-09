import type {
  AgenticTask,
  BrowserProfile,
  BrowserSession,
  ExtractionRule,
  TaskResult,
} from "../agent/universalBrowserController";
import { universalBrowserController } from "../agent/universalBrowserController";
import type {
  ActionResult as ComputerActionResult,
  ComputerUseSession,
  ScreenCoordinate,
  VisionAnalysisResult,
} from "../agent/computerUseEngine";
import { computerUseEngine } from "../agent/computerUseEngine";

export const OPENCLAW_BROWSER_PROFILES = [
  {
    id: "chrome-desktop",
    name: "Chrome Desktop",
    browserType: "chromium",
    viewport: { width: 1920, height: 1080 },
    mobile: false,
  },
  {
    id: "firefox-desktop",
    name: "Firefox Desktop",
    browserType: "firefox",
    viewport: { width: 1920, height: 1080 },
    mobile: false,
  },
  {
    id: "safari-desktop",
    name: "Safari Desktop",
    browserType: "webkit",
    viewport: { width: 1440, height: 900 },
    mobile: false,
  },
  {
    id: "mobile-iphone",
    name: "iPhone Safari",
    browserType: "webkit",
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
  {
    id: "mobile-android",
    name: "Android Chrome",
    browserType: "chromium",
    viewport: { width: 412, height: 915 },
    mobile: true,
  },
] as const;

export type OpenClawBrowserController = "browser" | "computer";
export type OpenClawBrowserMode = "browser" | "desktop";

type UniversalBrowserControllerLike = {
  createSession(
    profileId?: string,
    customProfile?: Partial<BrowserProfile>,
  ): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): BrowserSession | null;
  listTabs(sessionId: string): Array<{
    id: string;
    url: string;
    title: string;
    active: boolean;
  }>;
  navigate(
    sessionId: string,
    url: string,
    options?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
      timeout?: number;
      tabId?: string;
    },
  ): Promise<{ success: boolean; url: string; title: string; status?: number }>;
  click(
    sessionId: string,
    selector: string,
    options?: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      timeout?: number;
      force?: boolean;
    },
  ): Promise<{ success: boolean; error?: string }>;
  type(
    sessionId: string,
    selector: string,
    text: string,
    options?: { clear?: boolean; delay?: number; pressEnter?: boolean },
  ): Promise<{ success: boolean; error?: string }>;
  select(
    sessionId: string,
    selector: string,
    values: string | string[],
  ): Promise<{ success: boolean; selected: string[] }>;
  hover(sessionId: string, selector: string): Promise<void>;
  scroll(
    sessionId: string,
    options: {
      direction: "up" | "down" | "left" | "right";
      amount?: number;
      selector?: string;
    },
  ): Promise<void>;
  extract(sessionId: string, rules: ExtractionRule[]): Promise<Record<string, unknown>>;
  extractStructured(sessionId: string, description: string): Promise<unknown>;
  screenshot(
    sessionId: string,
    options?: {
      fullPage?: boolean;
      selector?: string;
      quality?: number;
      type?: "png" | "jpeg";
    },
  ): Promise<string>;
  executeAgenticTask(
    sessionId: string,
    task: AgenticTask,
  ): Promise<TaskResult>;
  agenticNavigate(
    sessionId: string,
    goal: string,
    maxSteps?: number,
    onStep?: ((step: unknown) => void) | undefined,
    options?: {
      maxRuntimeMs?: number;
      decisionTimeoutMs?: number;
      maxConsecutiveDecisionFailures?: number;
      allowedDomains?: string[];
    },
  ): Promise<{
    success: boolean;
    steps: string[];
    data: unknown;
    screenshots: string[];
  }>;
};

type ComputerUseEngineLike = {
  createSession(
    mode?: "browser" | "desktop",
    options?: {
      viewport?: { width: number; height: number };
      userAgent?: string;
      locale?: string;
    },
  ): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): ComputerUseSession | undefined;
  navigateToUrl(sessionId: string, url: string): Promise<ComputerActionResult>;
  mouseClick(
    sessionId: string,
    coordinates: ScreenCoordinate,
    options?: {
      button?: "left" | "right" | "middle";
      clickCount?: number;
      delay?: number;
    },
  ): Promise<ComputerActionResult>;
  mouseScroll(
    sessionId: string,
    coordinates: ScreenCoordinate,
    delta: { x: number; y: number },
  ): Promise<ComputerActionResult>;
  typeText(
    sessionId: string,
    text: string,
    options?: { delay?: number },
  ): Promise<ComputerActionResult>;
  pressKey(
    sessionId: string,
    key: string,
    modifiers?: string[],
  ): Promise<ComputerActionResult>;
  hotkey(sessionId: string, keys: string[]): Promise<ComputerActionResult>;
  captureScreenshot(
    sessionId: string,
    options?: { fullPage?: boolean; region?: unknown; quality?: number },
  ): Promise<string>;
  analyzeScreen(sessionId: string, query?: string): Promise<VisionAnalysisResult>;
  getPageContent?(sessionId: string): Promise<unknown>;
};

type BrowserRuntimeSessionRecord = {
  sessionId: string;
  userId: string;
  controller: OpenClawBrowserController;
  mode: OpenClawBrowserMode;
  profileId: string | null;
  objective: string | null;
  allowedDomains: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type OpenClawBrowserProfileSummary = (typeof OPENCLAW_BROWSER_PROFILES)[number];

export type OpenClawBrowserSessionSummary = {
  sessionId: string;
  controller: OpenClawBrowserController;
  mode: OpenClawBrowserMode;
  profileId: string | null;
  objective: string | null;
  allowedDomains: string[];
  createdAtMs: number;
  updatedAtMs: number;
  status: string;
  url: string | null;
  title: string | null;
  tabCount: number;
};

export type OpenClawBrowserStatus = {
  profiles: OpenClawBrowserProfileSummary[];
  activeSessions: number;
  counts: {
    browser: number;
    computerBrowser: number;
    computerDesktop: number;
  };
  capabilities: {
    multiBrowser: boolean;
    computerUse: boolean;
    structuredExtraction: boolean;
    agenticNavigation: boolean;
    visionAnalysis: boolean;
  };
  sessions: OpenClawBrowserSessionSummary[];
};

export type OpenClawBrowserNavigationResult = {
  sessionId: string;
  controller: OpenClawBrowserController;
  success: boolean;
  url: string | null;
  title: string | null;
  status?: number;
  error?: string;
};

export type OpenClawBrowserInteractionAction =
  | "click"
  | "type"
  | "select"
  | "hover"
  | "scroll"
  | "press_key"
  | "hotkey";

export type OpenClawBrowserInteractionResult = {
  sessionId: string;
  controller: OpenClawBrowserController;
  action: OpenClawBrowserInteractionAction;
  success: boolean;
  data?: unknown;
  error?: string;
};

export type OpenClawBrowserScreenshotResult = {
  sessionId: string;
  controller: OpenClawBrowserController;
  contentType: "image/png" | "image/jpeg";
  screenshot: string;
};

type CreateBrowserSessionParams = {
  userId: string;
  controller?: OpenClawBrowserController;
  mode?: OpenClawBrowserMode;
  profileId?: string;
  objective?: string;
  allowedDomains?: string[];
  viewport?: { width: number; height: number };
  customProfile?: Partial<BrowserProfile>;
};

type NavigateBrowserSessionParams = {
  userId: string;
  sessionId: string;
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeout?: number;
  tabId?: string;
};

type InteractBrowserSessionParams = {
  userId: string;
  sessionId: string;
  action: OpenClawBrowserInteractionAction;
  selector?: string;
  text?: string;
  value?: string;
  values?: string | string[];
  clear?: boolean;
  delay?: number;
  pressEnter?: boolean;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  force?: boolean;
  coordinates?: { x: number; y: number };
  modifiers?: string[];
};

type ExtractBrowserSessionParams = {
  userId: string;
  sessionId: string;
  rules?: ExtractionRule[];
  description?: string;
};

type ScreenshotBrowserSessionParams = {
  userId: string;
  sessionId: string;
  fullPage?: boolean;
  selector?: string;
  type?: "png" | "jpeg";
  quality?: number;
};

type AnalyzeBrowserSessionParams = {
  userId: string;
  sessionId: string;
  query?: string;
};

type RunBrowserAgenticParams = {
  userId: string;
  sessionId: string;
  goal?: string;
  maxSteps?: number;
  allowedDomains?: string[];
  task?: AgenticTask;
};

type OpenClawBrowserRuntimeDeps = {
  universalBrowserController?: UniversalBrowserControllerLike;
  computerUseEngine?: ComputerUseEngineLike;
  nowMs?: () => number;
};

function normalizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
}

function isAllowedUrl(url: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const hostname = new URL(url).hostname.toLowerCase();
  return allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function interactionError(
  sessionId: string,
  controller: OpenClawBrowserController,
  action: OpenClawBrowserInteractionAction,
  message: string,
): OpenClawBrowserInteractionResult {
  return {
    sessionId,
    controller,
    action,
    success: false,
    error: message,
  };
}

export class OpenClawBrowserRuntime {
  private readonly universalBrowserControllerImpl: UniversalBrowserControllerLike;
  private readonly computerUseEngineImpl: ComputerUseEngineLike;
  private readonly nowMs: () => number;
  private readonly sessions = new Map<string, BrowserRuntimeSessionRecord>();

  constructor(deps: OpenClawBrowserRuntimeDeps = {}) {
    this.universalBrowserControllerImpl =
      deps.universalBrowserController ?? universalBrowserController;
    this.computerUseEngineImpl = deps.computerUseEngine ?? computerUseEngine;
    this.nowMs = deps.nowMs ?? (() => Date.now());
  }

  listProfiles(): OpenClawBrowserProfileSummary[] {
    return [...OPENCLAW_BROWSER_PROFILES];
  }

  async getStatus(userId: string): Promise<OpenClawBrowserStatus> {
    const sessions = await this.listSessions(userId);
    return {
      profiles: this.listProfiles(),
      activeSessions: sessions.length,
      counts: {
        browser: sessions.filter((session) => session.controller === "browser").length,
        computerBrowser: sessions.filter(
          (session) => session.controller === "computer" && session.mode === "browser",
        ).length,
        computerDesktop: sessions.filter(
          (session) => session.controller === "computer" && session.mode === "desktop",
        ).length,
      },
      capabilities: {
        multiBrowser: true,
        computerUse: true,
        structuredExtraction: true,
        agenticNavigation: true,
        visionAnalysis: true,
      },
      sessions,
    };
  }

  async createSession(
    params: CreateBrowserSessionParams,
  ): Promise<OpenClawBrowserSessionSummary> {
    const controller = params.controller ?? "browser";
    const mode = controller === "browser" ? "browser" : params.mode ?? "browser";
    const now = this.nowMs();

    let sessionId: string;
    let profileId: string | null = null;

    if (controller === "browser") {
      profileId = params.profileId?.trim() || "chrome-desktop";
      sessionId = await this.universalBrowserControllerImpl.createSession(
        profileId,
        params.customProfile,
      );
    } else {
      sessionId = await this.computerUseEngineImpl.createSession(mode, {
        viewport: params.viewport,
      });
    }

    this.sessions.set(sessionId, {
      sessionId,
      userId: params.userId,
      controller,
      mode,
      profileId,
      objective: params.objective?.trim() || null,
      allowedDomains: normalizeDomains(params.allowedDomains),
      createdAtMs: now,
      updatedAtMs: now,
    });

    const summary = await this.buildSummary(this.sessions.get(sessionId)!);
    if (!summary) {
      throw new Error(`Failed to initialize browser session ${sessionId}`);
    }
    return summary;
  }

  async listSessions(userId: string): Promise<OpenClawBrowserSessionSummary[]> {
    const ownedRecords = [...this.sessions.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

    const summaries = await Promise.all(
      ownedRecords.map((record) => this.buildSummary(record)),
    );
    return summaries.filter(
      (summary): summary is OpenClawBrowserSessionSummary => summary !== null,
    );
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<OpenClawBrowserSessionSummary | null> {
    const record = this.getOwnedRecord(userId, sessionId);
    if (!record) return null;
    return this.buildSummary(record);
  }

  async closeSession(
    userId: string,
    sessionId: string,
  ): Promise<{ closed: boolean; sessionId: string } | null> {
    const record = this.getOwnedRecord(userId, sessionId);
    if (!record) return null;

    if (record.controller === "browser") {
      await this.universalBrowserControllerImpl.closeSession(sessionId);
    } else {
      await this.computerUseEngineImpl.closeSession(sessionId);
    }

    this.sessions.delete(sessionId);
    return { closed: true, sessionId };
  }

  async navigate(
    params: NavigateBrowserSessionParams,
  ): Promise<OpenClawBrowserNavigationResult | null> {
    const record = this.getOwnedRecord(params.userId, params.sessionId);
    if (!record) return null;
    if (!isAllowedUrl(params.url, record.allowedDomains)) {
      return {
        sessionId: params.sessionId,
        controller: record.controller,
        success: false,
        url: null,
        title: null,
        error: `Domain not allowed for this session: ${params.url}`,
      };
    }

    this.touch(record.sessionId);

    if (record.controller === "browser") {
      const result = await this.universalBrowserControllerImpl.navigate(
        params.sessionId,
        params.url,
        {
          waitUntil: params.waitUntil,
          timeout: params.timeout,
          tabId: params.tabId,
        },
      );
      return {
        sessionId: params.sessionId,
        controller: record.controller,
        success: result.success,
        url: result.url || null,
        title: result.title || null,
        status: result.status,
        error: result.success ? undefined : "Navigation failed",
      };
    }

    const result = await this.computerUseEngineImpl.navigateToUrl(
      params.sessionId,
      params.url,
    );
    const liveSession = this.computerUseEngineImpl.getSession(params.sessionId);
    return {
      sessionId: params.sessionId,
      controller: record.controller,
      success: result.success,
      url: liveSession?.page?.url?.() || params.url,
      title: null,
      error: result.error,
    };
  }

  async interact(
    params: InteractBrowserSessionParams,
  ): Promise<OpenClawBrowserInteractionResult | null> {
    const record = this.getOwnedRecord(params.userId, params.sessionId);
    if (!record) return null;
    this.touch(record.sessionId);

    if (record.controller === "browser") {
      switch (params.action) {
        case "click": {
          if (!params.selector) {
            return interactionError(
              params.sessionId,
              record.controller,
              params.action,
              "selector is required",
            );
          }
          const result = await this.universalBrowserControllerImpl.click(
            params.sessionId,
            params.selector,
            {
              button: params.button,
              clickCount: params.clickCount,
              force: params.force,
            },
          );
          return {
            sessionId: params.sessionId,
            controller: record.controller,
            action: params.action,
            success: result.success,
            error: result.error,
          };
        }
        case "type": {
          if (!params.selector) {
            return interactionError(
              params.sessionId,
              record.controller,
              params.action,
              "selector is required",
            );
          }
          const result = await this.universalBrowserControllerImpl.type(
            params.sessionId,
            params.selector,
            params.text ?? params.value ?? "",
            {
              clear: params.clear,
              delay: params.delay,
              pressEnter: params.pressEnter,
            },
          );
          return {
            sessionId: params.sessionId,
            controller: record.controller,
            action: params.action,
            success: result.success,
            error: result.error,
          };
        }
        case "select": {
          if (!params.selector) {
            return interactionError(
              params.sessionId,
              record.controller,
              params.action,
              "selector is required",
            );
          }
          const result = await this.universalBrowserControllerImpl.select(
            params.sessionId,
            params.selector,
            params.values ?? params.value ?? "",
          );
          return {
            sessionId: params.sessionId,
            controller: record.controller,
            action: params.action,
            success: result.success,
            data: { selected: result.selected },
          };
        }
        case "hover": {
          if (!params.selector) {
            return interactionError(
              params.sessionId,
              record.controller,
              params.action,
              "selector is required",
            );
          }
          await this.universalBrowserControllerImpl.hover(
            params.sessionId,
            params.selector,
          );
          return {
            sessionId: params.sessionId,
            controller: record.controller,
            action: params.action,
            success: true,
          };
        }
        case "scroll": {
          await this.universalBrowserControllerImpl.scroll(params.sessionId, {
            direction: params.direction ?? "down",
            amount: params.amount,
            selector: params.selector,
          });
          return {
            sessionId: params.sessionId,
            controller: record.controller,
            action: params.action,
            success: true,
          };
        }
        case "press_key":
        case "hotkey":
          return interactionError(
            params.sessionId,
            record.controller,
            params.action,
            `${params.action} is not supported for browser controller sessions`,
          );
      }
    }

    switch (params.action) {
      case "click": {
        if (!params.coordinates) {
          return interactionError(
            params.sessionId,
            record.controller,
            params.action,
            "coordinates are required",
          );
        }
        const result = await this.computerUseEngineImpl.mouseClick(
          params.sessionId,
          params.coordinates,
          {
            button: params.button,
            clickCount: params.clickCount,
            delay: params.delay,
          },
        );
        return this.fromComputerActionResult(
          params.sessionId,
          record.controller,
          params.action,
          result,
        );
      }
      case "type": {
        const result = await this.computerUseEngineImpl.typeText(
          params.sessionId,
          params.text ?? params.value ?? "",
          { delay: params.delay },
        );
        return this.fromComputerActionResult(
          params.sessionId,
          record.controller,
          params.action,
          result,
        );
      }
      case "scroll": {
        const coordinates = params.coordinates ?? { x: 960, y: 540 };
        const amount = params.amount ?? 300;
        const y =
          params.direction === "up"
            ? -amount
            : params.direction === "down" || !params.direction
              ? amount
              : 0;
        const x =
          params.direction === "left"
            ? -amount
            : params.direction === "right"
              ? amount
              : 0;
        const result = await this.computerUseEngineImpl.mouseScroll(
          params.sessionId,
          coordinates,
          { x, y },
        );
        return this.fromComputerActionResult(
          params.sessionId,
          record.controller,
          params.action,
          result,
        );
      }
      case "press_key": {
        if (!params.value) {
          return interactionError(
            params.sessionId,
            record.controller,
            params.action,
            "value is required",
          );
        }
        const result = await this.computerUseEngineImpl.pressKey(
          params.sessionId,
          params.value,
          params.modifiers,
        );
        return this.fromComputerActionResult(
          params.sessionId,
          record.controller,
          params.action,
          result,
        );
      }
      case "hotkey": {
        const keys = params.modifiers && params.value
          ? [...params.modifiers, params.value]
          : params.value
            ? params.value
                .split("+")
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            : [];
        if (keys.length === 0) {
          return interactionError(
            params.sessionId,
            record.controller,
            params.action,
            "value is required",
          );
        }
        const result = await this.computerUseEngineImpl.hotkey(
          params.sessionId,
          keys,
        );
        return this.fromComputerActionResult(
          params.sessionId,
          record.controller,
          params.action,
          result,
        );
      }
      case "select":
      case "hover":
        return interactionError(
          params.sessionId,
          record.controller,
          params.action,
          `${params.action} is not supported for computer controller sessions`,
        );
    }
  }

  async extract(
    params: ExtractBrowserSessionParams,
  ): Promise<{ sessionId: string; controller: OpenClawBrowserController; data: unknown } | null> {
    const record = this.getOwnedRecord(params.userId, params.sessionId);
    if (!record) return null;
    this.touch(record.sessionId);

    if (record.controller === "browser") {
      if (params.rules?.length) {
        return {
          sessionId: params.sessionId,
          controller: record.controller,
          data: await this.universalBrowserControllerImpl.extract(
            params.sessionId,
            params.rules,
          ),
        };
      }

      if (params.description?.trim()) {
        return {
          sessionId: params.sessionId,
          controller: record.controller,
          data: await this.universalBrowserControllerImpl.extractStructured(
            params.sessionId,
            params.description.trim(),
          ),
        };
      }
    }

    if (typeof this.computerUseEngineImpl.getPageContent === "function") {
      return {
        sessionId: params.sessionId,
        controller: record.controller,
        data: await this.computerUseEngineImpl.getPageContent(params.sessionId),
      };
    }

    throw new Error("Extraction is not available for this session");
  }

  async screenshot(
    params: ScreenshotBrowserSessionParams,
  ): Promise<OpenClawBrowserScreenshotResult | null> {
    const record = this.getOwnedRecord(params.userId, params.sessionId);
    if (!record) return null;
    this.touch(record.sessionId);

    if (record.controller === "browser") {
      const type = params.type ?? "png";
      return {
        sessionId: params.sessionId,
        controller: record.controller,
        contentType: type === "jpeg" ? "image/jpeg" : "image/png",
        screenshot: await this.universalBrowserControllerImpl.screenshot(
          params.sessionId,
          {
            fullPage: params.fullPage,
            selector: params.selector,
            type,
            quality: params.quality,
          },
        ),
      };
    }

    return {
      sessionId: params.sessionId,
      controller: record.controller,
      contentType: "image/png",
      screenshot: await this.computerUseEngineImpl.captureScreenshot(
        params.sessionId,
        { fullPage: params.fullPage, quality: params.quality },
      ),
    };
  }

  async analyze(
    params: AnalyzeBrowserSessionParams,
  ): Promise<VisionAnalysisResult | null> {
    const record = this.getOwnedRecord(params.userId, params.sessionId);
    if (!record) return null;
    if (record.controller !== "computer") {
      throw new Error("Vision analysis is only available for computer controller sessions");
    }
    this.touch(record.sessionId);
    return this.computerUseEngineImpl.analyzeScreen(
      params.sessionId,
      params.query,
    );
  }

  async runAgentic(
    params: RunBrowserAgenticParams,
  ): Promise<
    | {
        sessionId: string;
        controller: OpenClawBrowserController;
        goal: string;
        result: {
          success: boolean;
          steps: string[];
          data: unknown;
          screenshots: string[];
        };
      }
    | {
        sessionId: string;
        controller: OpenClawBrowserController;
        taskId: string;
        result: TaskResult;
      }
    | null
  > {
    const record = this.getOwnedRecord(params.userId, params.sessionId);
    if (!record) return null;
    if (record.controller !== "browser") {
      throw new Error("Agentic browser workflows are only available for browser controller sessions");
    }
    this.touch(record.sessionId);

    if (params.task) {
      return {
        sessionId: params.sessionId,
        controller: record.controller,
        taskId: params.task.id,
        result: await this.universalBrowserControllerImpl.executeAgenticTask(
          params.sessionId,
          params.task,
        ),
      };
    }

    const goal = params.goal?.trim();
    if (!goal) {
      throw new Error("goal is required when task is not provided");
    }

    return {
      sessionId: params.sessionId,
      controller: record.controller,
      goal,
      result: await this.universalBrowserControllerImpl.agenticNavigate(
        params.sessionId,
        goal,
        params.maxSteps ?? 20,
        undefined,
        {
          allowedDomains:
            normalizeDomains(params.allowedDomains).length > 0
              ? normalizeDomains(params.allowedDomains)
              : record.allowedDomains,
        },
      ),
    };
  }

  private async buildSummary(
    record: BrowserRuntimeSessionRecord,
  ): Promise<OpenClawBrowserSessionSummary | null> {
    if (record.controller === "browser") {
      const live = this.universalBrowserControllerImpl.getSession(record.sessionId);
      if (!live) {
        this.sessions.delete(record.sessionId);
        return null;
      }
      const tabs = this.universalBrowserControllerImpl.listTabs(record.sessionId);
      const activeTab =
        tabs.find((tab) => tab.active) ||
        tabs[0] ||
        null;

      return {
        sessionId: record.sessionId,
        controller: record.controller,
        mode: record.mode,
        profileId: record.profileId,
        objective: record.objective,
        allowedDomains: [...record.allowedDomains],
        createdAtMs: record.createdAtMs,
        updatedAtMs: record.updatedAtMs,
        status: "active",
        url: activeTab?.url ?? null,
        title: activeTab?.title ?? null,
        tabCount: tabs.length,
      };
    }

    const live = this.computerUseEngineImpl.getSession(record.sessionId);
    if (!live) {
      this.sessions.delete(record.sessionId);
      return null;
    }

    return {
      sessionId: record.sessionId,
      controller: record.controller,
      mode: live.mode,
      profileId: record.profileId,
      objective: record.objective,
      allowedDomains: [...record.allowedDomains],
      createdAtMs: record.createdAtMs,
      updatedAtMs: record.updatedAtMs,
      status: live.status,
      url: live.page?.url?.() || null,
      title: null,
      tabCount: live.page ? 1 : 0,
    };
  }

  private getOwnedRecord(
    userId: string,
    sessionId: string,
  ): BrowserRuntimeSessionRecord | null {
    const record = this.sessions.get(sessionId);
    if (!record || record.userId !== userId) {
      return null;
    }
    return record;
  }

  private touch(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.updatedAtMs = this.nowMs();
  }

  private fromComputerActionResult(
    sessionId: string,
    controller: OpenClawBrowserController,
    action: OpenClawBrowserInteractionAction,
    result: ComputerActionResult,
  ): OpenClawBrowserInteractionResult {
    return {
      sessionId,
      controller,
      action,
      success: result.success,
      data: result.changesDetected ? { changesDetected: result.changesDetected } : undefined,
      error: result.error,
    };
  }
}

export const openClawBrowserRuntime = new OpenClawBrowserRuntime();
