export type SiteTarget = {
  tabId: number;
  origin: string;
  host: string;
  display: string;
  favIconUrl?: string;
  cookieStoreId?: string;
};

export type SiteLookup = SiteTarget | { unsupported: true; reason: string } | null;

export function getActiveTabSite(): Promise<SiteLookup>;

export function tabToSite(tab: browser.tabs.Tab): SiteLookup;

export function clearSiteData(
  target: { tabId: number; origin: string; host: string; cookieStoreId?: string },
  scope: { cookies: boolean; localStorage: boolean; sessionStorage: boolean }
): Promise<{
  cookiesRemoved: number;
  cookiesFailed: number;
  localKeys: number;
  sessionKeys: number;
}>;
