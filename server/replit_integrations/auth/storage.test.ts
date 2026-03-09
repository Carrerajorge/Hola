import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
const insertMock = vi.fn();
const userInsertValuesMock = vi.fn();
const identityInsertValuesMock = vi.fn();
const identityOnConflictDoUpdateMock = vi.fn();
const updateMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const publishMock = vi.fn();
const autoAcceptWorkspaceInvitationForUserMock = vi.fn();

const usersTable = {
  id: "users.id",
  email: "users.email",
  username: "users.username",
  fullName: "users.full_name",
  firstName: "users.first_name",
  lastName: "users.last_name",
  profileImageUrl: "users.profile_image_url",
  authProvider: "users.auth_provider",
  emailVerified: "users.email_verified",
  loginCount: "users.login_count",
  lastLoginAt: "users.last_login_at",
  lastIp: "users.last_ip",
  userAgent: "users.user_agent",
  updatedAt: "users.updated_at",
};
const userIdentitiesTable = {
  provider: "user_identities.provider",
  providerSubject: "user_identities.provider_subject",
};

vi.mock("../../db", () => ({
  db: {
    execute: (...args: any[]) => executeMock(...args),
    insert: (...args: any[]) => insertMock(...args),
    update: (...args: any[]) => updateMock(...args),
  },
}));

vi.mock("@shared/schema", () => ({
  users: usersTable,
  userSettings: {},
  libraryStorage: {},
  userIdentities: userIdentitiesTable,
}));

vi.mock("../../services/workspaceInvitationService", () => ({
  autoAcceptWorkspaceInvitationForUser: (...args: any[]) =>
    autoAcceptWorkspaceInvitationForUserMock(...args),
}));

vi.mock("../../services/authEventBus", () => ({
  authEventBus: {
    publish: (...args: any[]) => publishMock(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

async function loadAuthStorage() {
  return (await import("./storage")).authStorage;
}

describe("authStorage schema drift resilience", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    identityOnConflictDoUpdateMock.mockResolvedValue(undefined);
    identityInsertValuesMock.mockImplementation(() => ({
      onConflictDoUpdate: identityOnConflictDoUpdateMock,
    }));

    insertMock.mockImplementation((table: unknown) => {
      if (table === userIdentitiesTable) {
        return {
          values: identityInsertValuesMock,
        };
      }

      return {
        values: userInsertValuesMock,
      };
    });

    userInsertValuesMock.mockResolvedValue(undefined);

    updateWhereMock.mockResolvedValue(undefined);
    updateSetMock.mockReturnValue({
      where: updateWhereMock,
    });
    updateMock.mockReturnValue({
      set: updateSetMock,
    });

    autoAcceptWorkspaceInvitationForUserMock.mockResolvedValue(undefined);
  });

  it("updates an existing OAuth user without relying on RETURNING columns from newer schemas", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: "42703", message: 'column "email_canonical" does not exist' })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user_1",
            email: "test@example.com",
            username: "test",
            first_name: "Test",
            last_name: "User",
            full_name: "Test User",
            role: "user",
            status: "active",
            auth_provider: "email",
            email_verified: "false",
          },
        ],
      })
      .mockRejectedValueOnce({ code: "42703", message: 'column "org_id" does not exist' })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user_1",
            email: "test@example.com",
            password: null,
          },
        ],
      });

    const authStorage = await loadAuthStorage();
    const user = await authStorage.upsertUser({
      id: "google_123",
      email: "test@example.com",
      fullName: "Test User",
      firstName: "Test",
      lastName: "User",
      authProvider: "google",
      emailVerified: "true",
    });

    expect(user.id).toBe("user_1");
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
    expect(userInsertValuesMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith("IDENTITY_LINKED", "user_1", {
      provider: "google",
      resolvedBy: "email",
    });
  });

  it("retries user creation without org_id and email_canonical when production schema is behind", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: "42703", message: 'column "email_canonical" does not exist' })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: "42703", message: 'column "org_id" does not exist' })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "google_456",
            email: "new@example.com",
            password: null,
          },
        ],
      });

    userInsertValuesMock
      .mockRejectedValueOnce({ code: "42703", message: 'column "org_id" does not exist' })
      .mockResolvedValueOnce(undefined);

    const authStorage = await loadAuthStorage();
    const user = await authStorage.upsertUser({
      id: "google_456",
      email: "new@example.com",
      fullName: "New User",
      firstName: "New",
      lastName: "User",
      authProvider: "google",
      emailVerified: "true",
    });

    expect(user.id).toBe("google_456");
    expect(userInsertValuesMock).toHaveBeenCalledTimes(2);

    expect(userInsertValuesMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        id: "google_456",
        orgId: "google_456",
        emailCanonical: "new@example.com",
      }),
    );

    expect(userInsertValuesMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        id: "google_456",
        email: "new@example.com",
      }),
    );
    expect(userInsertValuesMock.mock.calls[1]?.[0]).not.toHaveProperty("orgId");
    expect(userInsertValuesMock.mock.calls[1]?.[0]).not.toHaveProperty("emailCanonical");

    expect(publishMock).toHaveBeenCalledWith("USER_REGISTERED", "google_456", {
      email: "new@example.com",
      provider: "google",
    });
  });
});
