export type ButtonVariant = "primary" | "secondary" | "danger";

export interface Theme {
  accentColor: string;
  backgroundColor: string;
  borderRadius: number;
}

export const defaultTheme: Theme = {
  accentColor: "#7B61FF",
  backgroundColor: "#0F0E17",
  borderRadius: 8
};

export function mergeTheme(base: Theme, overrides: Partial<Theme>): Theme {
  return { ...base, ...overrides };
}

export function getButtonClass(variant: ButtonVariant): string {
  return `cubica-btn-${variant}`;
}

export * from "./actions";
export * from "./components/GameButton";
export * from "./components/GameCard";
export * from "./components/GameVariable";
export * from "./components/GameArea";
export * from "./components/GameScreen";
export { default as HelperComponent } from "./components/HelperComponent";
export * from "./components/JournalVariable";
