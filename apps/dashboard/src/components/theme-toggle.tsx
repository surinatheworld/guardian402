"use client";

import { Moon, Sun } from "@gravity-ui/icons";
import { ToggleButton } from "@heroui/react/toggle-button";
import { ToggleButtonGroup } from "@heroui/react/toggle-button-group";
import { useSyncExternalStore } from "react";
import { setTheme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => null,
  );

  return (
    <ToggleButtonGroup
      aria-label="Giao diện"
      size="sm"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={theme ? [theme] : []}
      onSelectionChange={(keys) => {
        const [choice] = keys;
        if (choice === "light" || choice === "dark") setTheme(choice);
      }}
    >
      <ToggleButton id="light" isIconOnly aria-label="Chế độ sáng">
        <Sun aria-hidden="true" />
      </ToggleButton>
      <ToggleButton id="dark" isIconOnly aria-label="Chế độ tối">
        <Moon aria-hidden="true" />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
