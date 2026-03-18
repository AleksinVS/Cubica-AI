import type { ReactNode } from "react";

export interface GameCanvasProps {
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function GameCanvas({ header, footer, children }: GameCanvasProps) {
  return (
    <div className="cubica-game-canvas">
      {header && <div className="cubica-game-canvas__header">{header}</div>}
      <div className="cubica-game-canvas__body">{children}</div>
      {footer && <div className="cubica-game-canvas__footer">{footer}</div>}
    </div>
  );
}