export type Theme = "light" | "dark";

const STORAGE_KEY = "guardian402-theme";
const CHANGE_EVENT = "guardian402-theme-change";

// Run before the first paint so a saved theme also applies on a hard refresh.
export const THEME_SCRIPT = `(() => {
  const root = document.documentElement;

  function readPreference() {
    try {
      const saved = window.localStorage.getItem("${STORAGE_KEY}");
      return saved === "light" || saved === "dark" ? saved : null;
    } catch {
      return null;
    }
  }

  let preference = readPreference();

  function applyTheme() {
    const theme = preference ?? "dark";
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  applyTheme();
  window.addEventListener("storage", (event) => {
    if (event.key === "${STORAGE_KEY}" || event.key === null) {
      preference = readPreference();
      applyTheme();
    }
  });

  window.addEventListener("${CHANGE_EVENT}", (event) => {
    if (event.detail !== "light" && event.detail !== "dark") return;
    preference = event.detail;
    try {
      window.localStorage.setItem("${STORAGE_KEY}", preference);
    } catch {
      // The choice still applies to this page when browser storage is blocked.
    }
    applyTheme();
  });
})();`;

export function setTheme(theme: Theme) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: theme }));
}
