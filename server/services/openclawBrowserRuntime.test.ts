import { describe, expect, it, vi } from "vitest";
import { OpenClawBrowserRuntime } from "./openclawBrowserRuntime";

describe("OpenClawBrowserRuntime", () => {
  it("creates and summarizes a browser controller session", async () => {
    const runtime = new OpenClawBrowserRuntime({
      universalBrowserController: {
        createSession: vi.fn(async () => "browser_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn((sessionId: string) =>
          sessionId === "browser_sess_1"
            ? ({
                id: sessionId,
                activeTabId: "tab_1",
                tabs: new Map(),
              } as any)
            : null,
        ),
        listTabs: vi.fn(() => [
          {
            id: "tab_1",
            url: "https://example.com",
            title: "Example",
            active: true,
          },
        ]),
        navigate: vi.fn(async () => ({
          success: true,
          url: "https://example.com",
          title: "Example",
          status: 200,
        })),
        click: vi.fn(async () => ({ success: true })),
        type: vi.fn(async () => ({ success: true })),
        select: vi.fn(async () => ({ success: true, selected: ["one"] })),
        hover: vi.fn(async () => {}),
        scroll: vi.fn(async () => {}),
        extract: vi.fn(async () => ({ title: "Example" })),
        extractStructured: vi.fn(async () => ({ summary: "Example" })),
        screenshot: vi.fn(async () => "base64-png"),
        executeAgenticTask: vi.fn(async () => ({
          taskId: "task_1",
          success: true,
          stepsCompleted: 1,
          totalSteps: 1,
          results: [],
          extractedData: {},
          screenshots: [],
          errors: [],
          duration: 12,
        })),
        agenticNavigate: vi.fn(async () => ({
          success: true,
          steps: ["navigate"],
          data: { extracted: true },
          screenshots: [],
        })),
      },
      computerUseEngine: {
        createSession: vi.fn(async () => "computer_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn(() => undefined),
        navigateToUrl: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseClick: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseScroll: vi.fn(async () => ({ success: true, duration: 1 })),
        typeText: vi.fn(async () => ({ success: true, duration: 1 })),
        pressKey: vi.fn(async () => ({ success: true, duration: 1 })),
        hotkey: vi.fn(async () => ({ success: true, duration: 1 })),
        captureScreenshot: vi.fn(async () => "base64"),
        analyzeScreen: vi.fn(async () => ({
          description: "analysis",
          elements: [],
          suggestedActions: [],
          currentState: "ready",
          confidence: 0.8,
        })),
        getPageContent: vi.fn(async () => ({ title: "Example" })),
      },
      nowMs: () => 1000,
    });

    const session = await runtime.createSession({
      userId: "user_test",
      controller: "browser",
      profileId: "chrome-desktop",
      objective: "Research a page",
      allowedDomains: ["example.com"],
    });

    expect(session).toMatchObject({
      sessionId: "browser_sess_1",
      controller: "browser",
      mode: "browser",
      profileId: "chrome-desktop",
      objective: "Research a page",
      url: "https://example.com",
      title: "Example",
      tabCount: 1,
      allowedDomains: ["example.com"],
    });

    const status = await runtime.getStatus("user_test");
    expect(status.activeSessions).toBe(1);
    expect(status.counts.browser).toBe(1);
    expect(status.sessions[0].sessionId).toBe("browser_sess_1");
  });

  it("enforces allowed domains during navigation", async () => {
    const navigate = vi.fn(async () => ({
      success: true,
      url: "https://example.com",
      title: "Example",
      status: 200,
    }));
    const runtime = new OpenClawBrowserRuntime({
      universalBrowserController: {
        createSession: vi.fn(async () => "browser_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn(() => ({ id: "browser_sess_1", activeTabId: "tab_1", tabs: new Map() } as any)),
        listTabs: vi.fn(() => [{ id: "tab_1", url: "https://example.com", title: "Example", active: true }]),
        navigate,
        click: vi.fn(async () => ({ success: true })),
        type: vi.fn(async () => ({ success: true })),
        select: vi.fn(async () => ({ success: true, selected: [] })),
        hover: vi.fn(async () => {}),
        scroll: vi.fn(async () => {}),
        extract: vi.fn(async () => ({})),
        extractStructured: vi.fn(async () => ({})),
        screenshot: vi.fn(async () => "base64"),
        executeAgenticTask: vi.fn(async () => ({} as any)),
        agenticNavigate: vi.fn(async () => ({} as any)),
      },
      computerUseEngine: {
        createSession: vi.fn(async () => "computer_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn(() => undefined),
        navigateToUrl: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseClick: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseScroll: vi.fn(async () => ({ success: true, duration: 1 })),
        typeText: vi.fn(async () => ({ success: true, duration: 1 })),
        pressKey: vi.fn(async () => ({ success: true, duration: 1 })),
        hotkey: vi.fn(async () => ({ success: true, duration: 1 })),
        captureScreenshot: vi.fn(async () => "base64"),
        analyzeScreen: vi.fn(async () => ({
          description: "analysis",
          elements: [],
          suggestedActions: [],
          currentState: "ready",
          confidence: 0.8,
        })),
        getPageContent: vi.fn(async () => ({ title: "Example" })),
      },
    });

    await runtime.createSession({
      userId: "user_test",
      controller: "browser",
      allowedDomains: ["example.com"],
    });

    const blocked = await runtime.navigate({
      userId: "user_test",
      sessionId: "browser_sess_1",
      url: "https://not-allowed.test",
    });

    expect(blocked).toMatchObject({
      success: false,
      error: expect.stringContaining("Domain not allowed"),
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("supports computer-use sessions for screenshot, analysis and keyboard actions", async () => {
    const pressKey = vi.fn(async () => ({ success: true, duration: 3, changesDetected: ["pressed"] }));
    const runtime = new OpenClawBrowserRuntime({
      universalBrowserController: {
        createSession: vi.fn(async () => "browser_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn(() => null),
        listTabs: vi.fn(() => []),
        navigate: vi.fn(async () => ({ success: true, url: "", title: "" })),
        click: vi.fn(async () => ({ success: true })),
        type: vi.fn(async () => ({ success: true })),
        select: vi.fn(async () => ({ success: true, selected: [] })),
        hover: vi.fn(async () => {}),
        scroll: vi.fn(async () => {}),
        extract: vi.fn(async () => ({})),
        extractStructured: vi.fn(async () => ({})),
        screenshot: vi.fn(async () => "base64"),
        executeAgenticTask: vi.fn(async () => ({} as any)),
        agenticNavigate: vi.fn(async () => ({} as any)),
      },
      computerUseEngine: {
        createSession: vi.fn(async () => "computer_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn((sessionId: string) =>
          sessionId === "computer_sess_1"
            ? ({
                id: sessionId,
                mode: "desktop",
                status: "active",
                page: undefined,
              } as any)
            : undefined,
        ),
        navigateToUrl: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseClick: vi.fn(async () => ({ success: true, duration: 1, changesDetected: ["clicked"] })),
        mouseScroll: vi.fn(async () => ({ success: true, duration: 1, changesDetected: ["scrolled"] })),
        typeText: vi.fn(async () => ({ success: true, duration: 1, changesDetected: ["typed"] })),
        pressKey,
        hotkey: vi.fn(async () => ({ success: true, duration: 1, changesDetected: ["hotkey"] })),
        captureScreenshot: vi.fn(async () => "desktop-base64"),
        analyzeScreen: vi.fn(async () => ({
          description: "Desktop analysis",
          elements: [],
          suggestedActions: [],
          currentState: "desktop",
          confidence: 0.9,
        })),
        getPageContent: vi.fn(async () => ({ title: "Desktop" })),
      },
    });

    const session = await runtime.createSession({
      userId: "user_test",
      controller: "computer",
      mode: "desktop",
      objective: "Inspect desktop",
    });
    expect(session).toMatchObject({
      sessionId: "computer_sess_1",
      controller: "computer",
      mode: "desktop",
      status: "active",
    });

    const screenshot = await runtime.screenshot({
      userId: "user_test",
      sessionId: "computer_sess_1",
    });
    expect(screenshot).toMatchObject({
      contentType: "image/png",
      screenshot: "desktop-base64",
    });

    const analysis = await runtime.analyze({
      userId: "user_test",
      sessionId: "computer_sess_1",
      query: "What is on screen?",
    });
    expect(analysis?.currentState).toBe("desktop");

    const interaction = await runtime.interact({
      userId: "user_test",
      sessionId: "computer_sess_1",
      action: "press_key",
      value: "Enter",
      modifiers: ["ctrl"],
    });
    expect(interaction).toMatchObject({
      success: true,
      data: { changesDetected: ["pressed"] },
    });
    expect(pressKey).toHaveBeenCalledWith("computer_sess_1", "Enter", ["ctrl"]);
  });

  it("runs agentic browser flows only on browser controller sessions", async () => {
    const agenticNavigate = vi.fn(async () => ({
      success: true,
      steps: ["opened", "extracted"],
      data: { extracted: true },
      screenshots: ["shot1"],
    }));
    const runtime = new OpenClawBrowserRuntime({
      universalBrowserController: {
        createSession: vi.fn(async () => "browser_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn(() => ({ id: "browser_sess_1", activeTabId: "tab_1", tabs: new Map() } as any)),
        listTabs: vi.fn(() => [{ id: "tab_1", url: "https://example.com", title: "Example", active: true }]),
        navigate: vi.fn(async () => ({ success: true, url: "https://example.com", title: "Example" })),
        click: vi.fn(async () => ({ success: true })),
        type: vi.fn(async () => ({ success: true })),
        select: vi.fn(async () => ({ success: true, selected: [] })),
        hover: vi.fn(async () => {}),
        scroll: vi.fn(async () => {}),
        extract: vi.fn(async () => ({})),
        extractStructured: vi.fn(async () => ({})),
        screenshot: vi.fn(async () => "base64"),
        executeAgenticTask: vi.fn(async () => ({
          taskId: "task_1",
          success: true,
          stepsCompleted: 1,
          totalSteps: 1,
          results: [],
          extractedData: {},
          screenshots: [],
          errors: [],
          duration: 1,
        })),
        agenticNavigate,
      },
      computerUseEngine: {
        createSession: vi.fn(async () => "computer_sess_1"),
        closeSession: vi.fn(async () => {}),
        getSession: vi.fn(() => undefined),
        navigateToUrl: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseClick: vi.fn(async () => ({ success: true, duration: 1 })),
        mouseScroll: vi.fn(async () => ({ success: true, duration: 1 })),
        typeText: vi.fn(async () => ({ success: true, duration: 1 })),
        pressKey: vi.fn(async () => ({ success: true, duration: 1 })),
        hotkey: vi.fn(async () => ({ success: true, duration: 1 })),
        captureScreenshot: vi.fn(async () => "base64"),
        analyzeScreen: vi.fn(async () => ({
          description: "analysis",
          elements: [],
          suggestedActions: [],
          currentState: "ready",
          confidence: 0.8,
        })),
        getPageContent: vi.fn(async () => ({ title: "Example" })),
      },
    });

    await runtime.createSession({
      userId: "user_test",
      controller: "browser",
      allowedDomains: ["example.com"],
    });

    const result = await runtime.runAgentic({
      userId: "user_test",
      sessionId: "browser_sess_1",
      goal: "Extract the headline",
      allowedDomains: ["example.com"],
      maxSteps: 5,
    });

    expect(result).toMatchObject({
      sessionId: "browser_sess_1",
      goal: "Extract the headline",
      result: {
        success: true,
        steps: ["opened", "extracted"],
      },
    });
    expect(agenticNavigate).toHaveBeenCalledWith(
      "browser_sess_1",
      "Extract the headline",
      5,
      undefined,
      { allowedDomains: ["example.com"] },
    );
  });
});
