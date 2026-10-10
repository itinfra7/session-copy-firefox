import { onMounted, ref } from 'vue';

/** Same patterns as manifest host_permissions. */
const SITE_ORIGINS = ['http://*/*', 'https://*/*'];

/**
 * Firefox MV3 lets users withdraw website access ("Access your data for all websites")
 * from about:addons at any time. Without it Copy / Paste / Clear cannot work.
 */
export function useHostAccess() {
  const granted = ref(true);

  async function refresh() {
    granted.value = await browser.permissions.contains({ origins: SITE_ORIGINS });
  }

  /** Must run directly inside a click handler (Firefox requires a user gesture). */
  function requestAccess() {
    void browser.permissions.request({ origins: SITE_ORIGINS }).then((ok) => {
      granted.value = ok;
    });
  }

  onMounted(() => void refresh());

  return { granted, requestAccess, refresh };
}
