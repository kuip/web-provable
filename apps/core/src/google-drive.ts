export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_DRIVE_OAUTH_SCOPES = Object.freeze([
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
]);

export interface GoogleDriveAccountV1 {
  schemaVersion: 1;
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface GoogleDriveSessionV1 {
  schemaVersion: 1;
  account: GoogleDriveAccountV1;
  grantedScopes: readonly string[];
}

/** Platform adapters keep OAuth tokens private and expose them only to Drive requests. */
export interface GoogleDriveAuthProvider {
  restore(): Promise<GoogleDriveSessionV1 | undefined>;
  connect(): Promise<GoogleDriveSessionV1>;
  disconnect(): Promise<void>;
  getAccessToken(): Promise<string>;
}

export interface BrowserGoogleDriveConnectionOptions {
  accountElement: HTMLElement;
  statusElement: HTMLElement;
  connectButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Shared Core presentation for platform-specific Google authorization providers.
 * Interactive authorization is triggered only by the explicit connect button.
 */
export class BrowserGoogleDriveConnection {
  private readonly accountElement: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly connectButton: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private provider: GoogleDriveAuthProvider | undefined;
  private operation = 0;

  constructor(options: BrowserGoogleDriveConnectionOptions) {
    this.accountElement = options.accountElement;
    this.statusElement = options.statusElement;
    this.connectButton = options.connectButton;
    this.disconnectButton = options.disconnectButton;
    this.connectButton.addEventListener("click", () => {
      void this.connect();
    });
    this.disconnectButton.addEventListener("click", () => {
      void this.disconnect();
    });
  }

  async configure(provider: GoogleDriveAuthProvider): Promise<void> {
    const operation = ++this.operation;
    this.provider = provider;
    this.showBusy("Checking Google Drive connection…");
    try {
      const session = await provider.restore();
      if (operation !== this.operation) {
        return;
      }
      if (session) {
        this.showConnected(session);
      } else {
        this.showDisconnected();
      }
    } catch (error) {
      if (operation === this.operation) {
        this.showError(error);
      }
    }
  }

  setUnavailable(message: string): void {
    ++this.operation;
    this.provider = undefined;
    this.accountElement.textContent = "Not connected";
    this.statusElement.textContent = message;
    delete this.statusElement.dataset.status;
    this.connectButton.disabled = true;
    this.disconnectButton.disabled = true;
  }

  async getAccessToken(): Promise<string> {
    if (!this.provider) {
      throw new Error("Google Drive is not available in this build");
    }
    return this.provider.getAccessToken();
  }

  private async connect(): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      return;
    }
    const operation = ++this.operation;
    this.showBusy("Waiting for Google authorization…");
    try {
      const session = await provider.connect();
      if (operation === this.operation) {
        this.showConnected(session);
      }
    } catch (error) {
      if (operation === this.operation) {
        this.showError(error);
      }
    }
  }

  private async disconnect(): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      return;
    }
    const operation = ++this.operation;
    this.showBusy("Disconnecting Google Drive…");
    try {
      await provider.disconnect();
      if (operation === this.operation) {
        this.showDisconnected("Disconnected from Google Drive on this device.");
      }
    } catch (error) {
      if (operation === this.operation) {
        this.showError(error);
      }
    }
  }

  private showBusy(message: string): void {
    this.statusElement.textContent = message;
    delete this.statusElement.dataset.status;
    this.connectButton.disabled = true;
    this.disconnectButton.disabled = true;
  }

  private showConnected(session: GoogleDriveSessionV1): void {
    this.accountElement.textContent = session.account.email;
    this.statusElement.textContent = "Connected. Provable can access only Drive files it creates or you select.";
    this.statusElement.dataset.status = "verified";
    this.connectButton.disabled = true;
    this.disconnectButton.disabled = false;
  }

  private showDisconnected(message = "Not connected. Connect to grant email and Drive file access."): void {
    this.accountElement.textContent = "Not connected";
    this.statusElement.textContent = message;
    delete this.statusElement.dataset.status;
    this.connectButton.disabled = false;
    this.disconnectButton.disabled = true;
  }

  private showError(error: unknown): void {
    this.accountElement.textContent = "Not connected";
    this.statusElement.textContent = formatError(error);
    this.statusElement.dataset.status = "invalid";
    this.connectButton.disabled = false;
    this.disconnectButton.disabled = true;
  }
}

export function normalizeGoogleOAuthClientId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "";
  }
  if (
    normalized.length > 255
    || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(normalized)
  ) {
    throw new Error("Google Drive OAuth client ID must end in .apps.googleusercontent.com");
  }
  return normalized;
}

export function hasGoogleDriveScopes(grantedScopes: readonly string[]): boolean {
  const granted = new Set(grantedScopes);
  return GOOGLE_DRIVE_OAUTH_SCOPES.every((scope) => granted.has(scope));
}

export async function fetchGoogleDriveAccount(
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<GoogleDriveAccountV1> {
  if (accessToken.length === 0) {
    throw new Error("Google access token is missing");
  }
  const response = await fetcher(GOOGLE_USERINFO_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Unable to read the connected Google account (${response.status})`);
  }
  const value: unknown = await response.json();
  if (
    !isRecord(value)
    || typeof value.sub !== "string"
    || value.sub.length === 0
    || typeof value.email !== "string"
    || value.email.length === 0
    || value.email_verified !== true
  ) {
    throw new Error("Google returned an invalid account profile");
  }
  return {
    schemaVersion: 1,
    id: value.sub,
    email: value.email,
    emailVerified: value.email_verified,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
