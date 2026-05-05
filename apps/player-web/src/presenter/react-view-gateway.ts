import type { IViewGateway, ViewCommand, ViewResponse } from "@cubica/sdk-core";

/**
 * Реализация IViewGateway для React.
 * Не рисует сам — только хранит подписчиков и уведомляет их о командах.
 * React-компонент подписывается через subscribe() и вызывает setState в callback.
 */
export class ReactViewGateway implements IViewGateway {
  private listeners: Array<(command: ViewCommand) => void> = [];

  subscribe(listener: (command: ViewCommand) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async dispatch(command: ViewCommand): Promise<ViewResponse> {
    this.listeners.forEach((l) => l(command));
    return { status: "COMPLETED" };
  }
}
