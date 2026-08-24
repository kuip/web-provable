import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
} from "@provable/core";
import {
  ChromeGoogleDriveAuth,
  type ChromeGoogleIdentityApi,
} from "../src/google-drive-auth";

const COMPLETE_SCOPES = [GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_USERINFO_EMAIL_SCOPE];

describe("Chrome Google Drive authorization", () => {
  it("restores a cached session and exposes the verified email", async () => {
    const identity = fakeIdentity({
      token: "access-token",
      grantedScopes: COMPLETE_SCOPES,
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      sub: "account-id",
      email: "person@example.com",
      email_verified: true,
    }), { status: 200 }));
    const auth = new ChromeGoogleDriveAuth({ identity, fetcher });

    await expect(auth.restore()).resolves.toMatchObject({
      account: { id: "account-id", email: "person@example.com" },
      grantedScopes: COMPLETE_SCOPES,
    });
    expect(identity.getAuthToken).toHaveBeenCalledWith(expect.objectContaining({
      interactive: false,
      enableGranularPermissions: true,
      scopes: COMPLETE_SCOPES,
    }));
    await expect(auth.getAccessToken()).resolves.toBe("access-token");
  });

  it("treats a non-interactive authorization failure as disconnected", async () => {
    const identity = fakeIdentity({ token: "unused" });
    vi.mocked(identity.getAuthToken).mockRejectedValueOnce(new Error("prompt required"));
    const auth = new ChromeGoogleDriveAuth({ identity });

    await expect(auth.restore()).resolves.toBeUndefined();
  });

  it("rejects a partial granular grant and removes its cached token", async () => {
    const identity = fakeIdentity({
      token: "partial-token",
      grantedScopes: [GOOGLE_DRIVE_FILE_SCOPE],
    });
    const auth = new ChromeGoogleDriveAuth({ identity });

    await expect(auth.connect()).rejects.toThrow("both Google Drive file access and email access");
    expect(identity.removeCachedAuthToken).toHaveBeenCalledWith({ token: "partial-token" });
  });

  it("clears the extension's cached authorization on disconnect", async () => {
    const identity = fakeIdentity({ token: "unused" });
    const auth = new ChromeGoogleDriveAuth({ identity });

    await auth.disconnect();
    expect(identity.clearAllCachedAuthTokens).toHaveBeenCalledOnce();
  });
});

function fakeIdentity(
  result: chrome.identity.GetAuthTokenResult,
): ChromeGoogleIdentityApi & {
  getAuthToken: ReturnType<typeof vi.fn>;
  removeCachedAuthToken: ReturnType<typeof vi.fn>;
  clearAllCachedAuthTokens: ReturnType<typeof vi.fn>;
} {
  return {
    getAuthToken: vi.fn(async () => result),
    removeCachedAuthToken: vi.fn(async () => undefined),
    clearAllCachedAuthTokens: vi.fn(async () => undefined),
  };
}
