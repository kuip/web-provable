import { describe, expect, it, vi } from "vitest";

import {
  fetchGoogleDriveAccount,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
  GOOGLE_USERINFO_ENDPOINT,
  hasGoogleDriveScopes,
  normalizeGoogleOAuthClientId,
} from "../src/google-drive";

describe("Google Drive authorization contracts", () => {
  it("validates public Google OAuth client IDs", () => {
    expect(normalizeGoogleOAuthClientId(" 123-example.apps.googleusercontent.com "))
      .toBe("123-example.apps.googleusercontent.com");
    expect(normalizeGoogleOAuthClientId("   ")).toBe("");
    expect(() => normalizeGoogleOAuthClientId("client-secret"))
      .toThrow("must end in .apps.googleusercontent.com");
  });

  it("requires both the narrow Drive scope and email scope", () => {
    expect(hasGoogleDriveScopes([
      GOOGLE_DRIVE_FILE_SCOPE,
      GOOGLE_USERINFO_EMAIL_SCOPE,
    ])).toBe(true);
    expect(hasGoogleDriveScopes([GOOGLE_DRIVE_FILE_SCOPE])).toBe(false);
  });

  it("loads the authorized account without leaking the token into the URL", async () => {
    const fetcher = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      sub: "google-account-id",
      email: "person@example.com",
      email_verified: true,
    }), { status: 200 }));

    await expect(fetchGoogleDriveAccount("opaque-token", fetcher)).resolves.toEqual({
      schemaVersion: 1,
      id: "google-account-id",
      email: "person@example.com",
      emailVerified: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(GOOGLE_USERINFO_ENDPOINT);
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer opaque-token");
  });

  it("rejects unsuccessful or malformed account responses", async () => {
    await expect(fetchGoogleDriveAccount("token", async () => new Response("", {
      status: 401,
    }))).rejects.toThrow("connected Google account (401)");
    await expect(fetchGoogleDriveAccount("token", async () => new Response(JSON.stringify({
      sub: "id",
      email: "person@example.com",
    }), { status: 200 }))).rejects.toThrow("invalid account profile");
    await expect(fetchGoogleDriveAccount("token", async () => new Response(JSON.stringify({
      sub: "id",
      email: "person@example.com",
      email_verified: false,
    }), { status: 200 }))).rejects.toThrow("invalid account profile");
  });
});
