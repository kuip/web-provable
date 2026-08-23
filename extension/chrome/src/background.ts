async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function protectLocalSettings(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

async function configureExtension(): Promise<void> {
  await Promise.all([configureSidePanel(), protectLocalSettings()]);
}

chrome.runtime.onInstalled.addListener(() => {
  void configureExtension();
});

chrome.runtime.onStartup.addListener(() => {
  void configureExtension();
});

void configureExtension();
