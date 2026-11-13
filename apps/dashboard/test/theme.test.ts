import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_SCRIPT } from "@/lib/theme";

function renderTheme(saved: string | null) {
  const listeners: Record<string, (event: { detail?: string; key?: string | null }) => void> = {};
  const classes = new Set<string>();
  const root = {
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    dataset: { theme: "" },
    style: { colorScheme: "" },
  };
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => (saved = value) };
  runInNewContext(THEME_SCRIPT, {
    document: { documentElement: root },
    window: {
      localStorage: storage,
      addEventListener: (name: string, fn: (event: { detail?: string; key?: string | null }) => void) =>
        (listeners[name] = fn),
    },
  });
  return { root, classes, listeners };
}

describe("theme preference", () => {
  it("defaults to dark without a saved choice", () => {
    const { root, classes } = renderTheme(null);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(classes.has("dark")).toBe(true);
  });

  it("respects a saved light choice and updates when toggled", () => {
    const { root, classes, listeners } = renderTheme("light");
    expect(root.dataset.theme).toBe("light");
    expect(classes.has("dark")).toBe(false);
    listeners["guardian402-theme-change"]?.({ detail: "dark" });
    expect(root.dataset.theme).toBe("dark");
    expect(classes.has("dark")).toBe(true);
  });
});
