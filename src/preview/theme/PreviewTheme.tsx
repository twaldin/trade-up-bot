import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type PreviewThemeName = "light" | "dark";

const PreviewThemeContext = createContext<{
  theme: PreviewThemeName;
  setTheme: (theme: PreviewThemeName) => void;
}>({
  theme: "light",
  setTheme: () => {},
});

function readStoredTheme(): PreviewThemeName {
  try {
    return localStorage.getItem("pv-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function PreviewThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<PreviewThemeName>(readStoredTheme);

  useEffect(() => {
    try {
      localStorage.setItem("pv-theme", theme);
    } catch { /* ignore quota */ }
    document.documentElement.dataset.pvTheme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.add("pv-html");
    document.body.classList.add("pv-body");
    return () => {
      document.documentElement.classList.remove("dark", "pv-html");
      document.body.classList.remove("pv-body");
      delete document.documentElement.dataset.pvTheme;
    };
  }, [theme]);

  const setTheme = (next: PreviewThemeName) => {
    setThemeState(next);
  };

  return (
    <PreviewThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </PreviewThemeContext.Provider>
  );
}

export function usePreviewTheme() {
  return useContext(PreviewThemeContext);
}

export function PreviewThemeToggle() {
  const { theme, setTheme } = usePreviewTheme();
  return (
    <button
      type="button"
      className="pv-btn pv-btn-ghost"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
