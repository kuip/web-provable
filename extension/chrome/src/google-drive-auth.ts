import {
  fetchGoogleDriveAccount,
  GOOGLE_DRIVE_OAUTH_SCOPES,
  hasGoogleDriveScopes,
  type GoogleDriveAuthProvider,
  type GoogleDriveSessionV1,
} from "@provable/core";

export interface ChromeGoogleIdentityApi {
  getAuthToken(
    details: chrome.identity.TokenDetails,
  ): Promise<chrome.identity.GetAuthTokenResult>;
  removeCachedAuthToken(details: chrome.identity.InvalidTokenDetails): Promise<void>;
  clearAllCachedAuthTokens(): Promise<void>;
}

export interface ChromeGoogleDriveAuthOptions {
  identity?: ChromeGoogleIdentityApi;
  fetcher?: typeof fetch;
}

/** Chrome owns token caching and refresh; Provable never persists the bearer token. */
export class ChromeGoogleDriveAuth implements GoogleDriveAuthProvider {
  private readonly identity: ChromeGoogleIdentityApi;
  private readonly fetcher: typeof fetch;

  constructor(options: ChromeGoogleDriveAuthOptions = {}) {
    this.identity = options.identity ?? chrome.identity;
    this.fetcher = options.fetcher ?? fetch;
  }

  async restore(): Promise<GoogleDriveSessionV1 | undefined> {
    let result: chrome.identity.GetAuthTokenResult;
    try {
      result = await this.requestToken(false);
    } catch {
      return undefined;
    }
    if (!result.token) {
      return undefined;
    }
    return this.createSession(result);
  }

  async connect(): Promise<GoogleDriveSessionV1> {
    const result = await this.requestToken(true);
    if (!result.token) {
      throw new Error("Google did not return an access token");
    }
    return this.createSession(result);
  }

  async disconnect(): Promise<void> {
    await this.identity.clearAllCachedAuthTokens();
  }

  async getAccessToken(): Promise<string> {
    const result = await this.requestToken(false);
    return this.requireAuthorizedToken(result);
  }

  private requestToken(interactive: boolean): Promise<chrome.identity.GetAuthTokenResult> {
    return this.identity.getAuthToken({
      interactive,
      enableGranularPermissions: true,
      scopes: [...GOOGLE_DRIVE_OAUTH_SCOPES],
    });
  }

  private async createSession(
    result: chrome.identity.GetAuthTokenResult,
  ): Promise<GoogleDriveSessionV1> {
    const accessToken = await this.requireAuthorizedToken(result);
    const account = await fetchGoogleDriveAccount(accessToken, this.fetcher);
    return {
      schemaVersion: 1,
      account,
      grantedScopes: result.grantedScopes ?? [...GOOGLE_DRIVE_OAUTH_SCOPES],
    };
  }

  private async requireAuthorizedToken(
    result: chrome.identity.GetAuthTokenResult,
  ): Promise<string> {
    const token = result.token;
    if (!token) {
      throw new Error("Google Drive is not connected");
    }
    const grantedScopes = result.grantedScopes ?? GOOGLE_DRIVE_OAUTH_SCOPES;
    if (!hasGoogleDriveScopes(grantedScopes)) {
      await this.identity.removeCachedAuthToken({ token });
      throw new Error("Grant both Google Drive file access and email access to connect");
    }
    return token;
  }
}
