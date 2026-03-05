import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ComputerControlPlane } from "../../server/capabilities/computer-control/ComputerControlPlane";

describe("ComputerControlPlane", () => {
  let plane: ComputerControlPlane;

  beforeEach(() => {
    plane = new ComputerControlPlane({
      mode: "SUPERVISED",
      shellEnabled: true,
      desktopEnabled: true,
      browserEnabled: true,
    });
  });

  afterEach(async () => {
    await plane.shutdown();
  });

  describe("status", () => {
    it("should report initial status", () => {
      const status = plane.getStatus();
      expect(status.mode).toBe("SUPERVISED");
      expect(status.shellEnabled).toBe(true);
      expect(status.desktopEnabled).toBe(true);
      expect(status.browserEnabled).toBe(true);
      expect(status.killSwitchActive).toBe(false);
      expect(status.desktopArmed).toBe(false);
    });
  });

  describe("mode management", () => {
    it("should change mode", () => {
      plane.setMode("SAFE");
      expect(plane.getMode()).toBe("SAFE");

      plane.setMode("AUTOPILOT");
      expect(plane.getMode()).toBe("AUTOPILOT");
    });
  });

  describe("shell execution", () => {
    it("should execute simple commands", async () => {
      const result = await plane.executeCommand({
        command: "echo test-from-plane",
        userId: "test",
        sessionId: "test",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("test-from-plane");
    });

    it("should assess command risk", () => {
      const assessment = plane.assessCommandRisk("rm -rf /");
      expect(assessment.riskLevel).toBe("CRITICAL");
    });

    it("should dry-run commands", async () => {
      const result = await plane.executeCommand({
        command: "echo dry-test",
        dryRun: true,
        userId: "test",
        sessionId: "test",
      });

      expect(result.dryRun).toBe(true);
      expect(result.stdout).toContain("[DRY-RUN]");
    });
  });

  describe("desktop control", () => {
    it("should start disarmed", () => {
      expect(plane.isDesktopArmed()).toBe(false);
    });

    it("should arm and disarm", () => {
      plane.armDesktop();
      expect(plane.isDesktopArmed()).toBe(true);

      plane.disarmDesktop();
      expect(plane.isDesktopArmed()).toBe(false);
    });

    it("should block desktop actions when not armed", async () => {
      const result = await plane.executeDesktopAction(
        { type: "click", x: 100, y: 100 },
        "test",
        "test",
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not armed");
    });

    it("should allow listing windows without arming", async () => {
      const result = await plane.executeDesktopAction(
        { type: "listWindows" },
        "test",
        "test",
      );
      // May fail on headless environments but should not throw "not armed" error
      expect(result.error || "").not.toContain("not armed");
    });
  });

  describe("kill switch", () => {
    it("should block all tools when activated", async () => {
      plane.activateKillSwitch();
      expect(plane.isKillSwitchActive()).toBe(true);

      await expect(
        plane.executeCommand({ command: "echo test", userId: "test", sessionId: "test" }),
      ).rejects.toThrow("kill switch");

      await expect(
        plane.executeDesktopAction({ type: "screenshot" }, "test", "test"),
      ).rejects.toThrow("kill switch");
    });

    it("should resume after deactivation", async () => {
      plane.activateKillSwitch();
      plane.deactivateKillSwitch();

      const result = await plane.executeCommand({
        command: "echo resumed",
        userId: "test",
        sessionId: "test",
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("disabled tools", () => {
    it("should block shell when disabled", async () => {
      const restricted = new ComputerControlPlane({
        shellEnabled: false,
        desktopEnabled: true,
        browserEnabled: true,
      });

      await expect(
        restricted.executeCommand({ command: "echo test", userId: "test", sessionId: "test" }),
      ).rejects.toThrow("disabled");

      await restricted.shutdown();
    });
  });

  describe("audit log", () => {
    it("should record shell executions", async () => {
      await plane.executeCommand({
        command: "echo audit-test",
        userId: "test",
        sessionId: "test",
      });

      const log = plane.getAuditLog(10);
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].tool).toBe("shell");
    });
  });
});
