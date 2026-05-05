/**
 * Строка кнопок панели (журнал, подсказка, стрелки навигации).
 */
export function PanelButtonRow({
  onJournal,
  onHint,
  disabled = false,
  layoutMode,
  showArrows = true
}: {
  onJournal: () => void;
  onHint: () => void;
  disabled?: boolean;
  layoutMode?: "leftsidebar" | "topbar";
  showArrows?: boolean;
}) {
  return (
    <div
      className="button-container panel-buttons"
      style={layoutMode === "topbar" ? { position: "relative", top: "-11px" } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <button id="btn-journal" className="button-helper" type="button" onClick={onJournal} disabled={disabled}>
        журнал ходов
      </button>
      <button id="btn-hint" className="button-helper" type="button" onClick={onHint} disabled={disabled}>
        подсказка
      </button>
      {showArrows ? (
        <>
          <button id="nav-left" className="button-helper-arrow" type="button" disabled>
            Назад
          </button>
          <button id="nav-right" className="button-helper-arrow" type="button" disabled>
            Вперед
          </button>
        </>
      ) : null}
    </div>
  );
}
