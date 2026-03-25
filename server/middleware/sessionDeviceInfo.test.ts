import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import {
  sessionDeviceInfoMiddleware,
  shouldTrackSessionDeviceInfo,
} from "./sessionDeviceInfo";

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
    session: {},
    ...overrides,
  } as Request;
}

describe("shouldTrackSessionDeviceInfo", () => {
  it("skips creating anonymous session metadata on safe public requests", () => {
    const req = makeRequest({
      method: "GET",
      session: {},
    });

    expect(shouldTrackSessionDeviceInfo(req)).toBe(false);
  });

  it("tracks authenticated or persisted sessions on safe requests", () => {
    const req = makeRequest({
      method: "GET",
      session: { authUserId: "user-123" },
    });

    expect(shouldTrackSessionDeviceInfo(req)).toBe(true);
  });

  it("tracks mutating anonymous requests", () => {
    const req = makeRequest({
      method: "POST",
      session: {},
    });

    expect(shouldTrackSessionDeviceInfo(req)).toBe(true);
  });
});

describe("sessionDeviceInfoMiddleware", () => {
  it("leaves safe anonymous requests untouched", () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = makeRequest({
      method: "GET",
      session: {},
    });

    sessionDeviceInfoMiddleware(req, {} as Response, next);

    expect(req.session).toEqual({});
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("records device metadata when tracking is enabled", () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = makeRequest({
      method: "GET",
      headers: { "user-agent": "Vitest" },
      session: { authUserId: "user-123" },
    });

    sessionDeviceInfoMiddleware(req, {} as Response, next);

    expect((req.session as any).device).toMatchObject({
      userAgent: "Vitest",
      ip: "127.0.0",
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
