import { describe, expect, it } from "vitest";

import { normalizeUpsertUserPayload } from "./upsertUserNormalization";

describe("normalizeUpsertUserPayload", () => {
  it("derives nullable-safe fields for OAuth inserts", () => {
    expect(
      normalizeUpsertUserPayload({
        id: "google_123",
        email: " user@example.com ",
        firstName: " Luis ",
        lastName: " Carrera ",
        profileImageUrl: " https://example.com/avatar.png ",
      }),
    ).toEqual({
      id: "google_123",
      email: "user@example.com",
      username: null,
      fullName: "Luis Carrera",
      firstName: "Luis",
      lastName: "Carrera",
      profileImageUrl: "https://example.com/avatar.png",
      role: null,
      authProvider: null,
      emailVerified: null,
      providerSubject: "google_123",
    });
  });

  it("keeps explicit values and collapses blanks to null", () => {
    expect(
      normalizeUpsertUserPayload({
        id: "ms_456",
        email: "admin@example.com",
        username: "  admin-user  ",
        fullName: "  Admin User  ",
        firstName: "  ",
        lastName: "",
        profileImageUrl: " ",
        role: "  admin ",
        authProvider: " microsoft ",
        emailVerified: " true ",
        providerSubject: " tenant-subject ",
      }),
    ).toEqual({
      id: "ms_456",
      email: "admin@example.com",
      username: "admin-user",
      fullName: "Admin User",
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      role: "admin",
      authProvider: "microsoft",
      emailVerified: "true",
      providerSubject: "tenant-subject",
    });
  });
});
