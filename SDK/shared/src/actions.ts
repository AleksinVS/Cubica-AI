/**
 * Абстракция для действий, описанных в манифесте Abstract View.
 * UI-компоненты не знают, как обрабатывать действия, и делегируют их презентеру через onAction.
 */
export interface ViewAction {
  command: string;
  payload?: Record<string, unknown>;
}

export interface ActionBinding {
  onClick?: ViewAction;
  onHover?: ViewAction;
}

export interface ActionContext {
  componentId?: string;
  event?: "click" | "hover";
}

export type ActionDispatcher = (action: ViewAction | undefined, context?: ActionContext) => void | Promise<void>;
