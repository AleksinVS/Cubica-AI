"use client";

/**
 * Asset library (секция «Ассеты» левого сайдбара; ADR-057 §4/§9.4; design-spec
 * §3.6; mockup ЗОНА 2).
 *
 * The library is the project's media/document shelf: a grid of asset cards with
 * a thumbnail (image) or a type icon, the file name, and a usage counter
 * («используется в N местах») or an «сирота» (orphan) marker. It supports a name
 * search, a type filter, and drag-and-drop upload of new files. Assets are FILES
 * of the game (`games/<id>/assets/`, ADR-009), never authoring entities.
 *
 * Presentational and game-agnostic: it renders the {@link GameAssetSummary} list
 * the controller loads and reports uploads/picks back through callbacks. In
 * "pick" mode (opened from the inspector's asset-reference widget) each card
 * becomes a «выбрать» button that routes the chosen asset path back to the field.
 */
import { useMemo, useRef, useState } from "react";

import type { GameAssetSummary, GameAssetType } from "./types.ts";

/** Type filter chips: «Все» plus one per coarse kind. */
type AssetTypeFilter = "all" | GameAssetType;

const TYPE_LABEL: Readonly<Record<GameAssetType, string>> = {
  image: "Картинки",
  audio: "Аудио",
  markdown: "Документы",
  other: "Прочее"
};
const TYPE_ICON: Readonly<Record<GameAssetType, string>> = {
  image: "🖼",
  audio: "🎵",
  markdown: "📄",
  other: "📦"
};
const TYPE_FILTER_ORDER: readonly AssetTypeFilter[] = ["all", "image", "audio", "markdown", "other"];

export interface AssetLibraryPanelProps {
  readonly assets: readonly GameAssetSummary[];
  /** Whether uploads are possible (an editor session worktree exists). */
  readonly canUpload: boolean;
  /** Persists dropped/selected files into the worktree assets tree. */
  readonly onUpload: (files: FileList) => void;
  /** Builds the thumbnail URL for an image asset. */
  readonly assetContentUrl: (assetPath: string) => string;
  readonly onCollapse: () => void;
  /**
   * Present only in "pick" mode (from the inspector widget): the field label the
   * library is picking an asset for, and the callback that routes the pick.
   */
  readonly pickForLabel?: string;
  readonly onPickAsset?: (assetPath: string) => void;
}

export function AssetLibraryPanel({
  assets,
  canUpload,
  onUpload,
  assetContentUrl,
  onCollapse,
  pickForLabel,
  onPickAsset
}: AssetLibraryPanelProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>("all");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const orphanCount = useMemo(() => assets.filter((asset) => asset.orphan).length, [assets]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== "all" && asset.type !== typeFilter) {
        return false;
      }
      if (orphansOnly && !asset.orphan) {
        return false;
      }
      return needle === "" || asset.name.toLowerCase().includes(needle);
    });
  }, [assets, query, typeFilter, orphansOnly]);

  const pickMode = pickForLabel !== undefined && onPickAsset !== undefined;

  return (
    <section
      className={`asset-library-panel${dragActive ? " is-drag-active" : ""}`}
      aria-label="Ассеты"
      data-testid="asset-library-panel"
      onDragOver={(event) => {
        if (canUpload) {
          event.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        setDragActive(false);
        if (!canUpload || event.dataTransfer.files.length === 0) {
          return;
        }
        event.preventDefault();
        onUpload(event.dataTransfer.files);
      }}
    >
      <div className="panel-heading">
        <strong>Ассеты</strong>
        <button type="button" onClick={onCollapse} aria-label="Collapse assets panel">
          Collapse
        </button>
      </div>

      {pickMode ? (
        <div className="asset-library-pick-banner" data-testid="asset-library-pick-banner">
          Выберите ассет для поля «{pickForLabel}»
        </div>
      ) : null}

      <div className="asset-library-controls">
        <input
          type="search"
          className="asset-library-search"
          placeholder="Поиск по имени…"
          aria-label="Поиск ассетов"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="asset-library-filters" role="group" aria-label="Фильтр по типу">
          {TYPE_FILTER_ORDER.map((filter) => (
            <button
              type="button"
              key={filter}
              className={typeFilter === filter ? "is-active" : ""}
              aria-pressed={typeFilter === filter}
              onClick={() => setTypeFilter(filter)}
            >
              {filter === "all" ? "Все" : TYPE_LABEL[filter]}
            </button>
          ))}
          <button
            type="button"
            className={`asset-library-orphan-filter${orphansOnly ? " is-active" : ""}`}
            aria-pressed={orphansOnly}
            data-testid="asset-library-orphan-filter"
            onClick={() => setOrphansOnly((current) => !current)}
            title="Показать только ассеты-сироты (0 использований)"
          >
            Сироты{orphanCount > 0 ? ` · ${orphanCount}` : ""}
          </button>
        </div>
      </div>

      <div className="asset-library-upload">
        <button type="button" disabled={!canUpload} onClick={() => fileInputRef.current?.click()}>
          Загрузить файл
        </button>
        <span className="asset-library-hint">{canUpload ? "или перетащите файл сюда" : "нужна сессия редактора"}</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-hidden="true"
          data-testid="asset-library-file-input"
          onChange={(event) => {
            if (event.target.files !== null && event.target.files.length > 0) {
              onUpload(event.target.files);
            }
            event.target.value = "";
          }}
        />
      </div>

      <div className="asset-library-grid" role="list">
        {visible.length === 0 ? (
          <p className="asset-library-empty">Нет ассетов.</p>
        ) : (
          visible.map((asset) => (
            <div
              key={asset.path}
              role="listitem"
              className={`asset-library-card${asset.orphan ? " is-orphan" : ""}`}
              data-testid="asset-library-card"
              data-asset-path={asset.path}
            >
              <div className="asset-library-thumb" aria-hidden="true">
                {asset.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetContentUrl(asset.path)} alt="" loading="lazy" />
                ) : (
                  <span className="asset-library-icon">{TYPE_ICON[asset.type]}</span>
                )}
              </div>
              <div className="asset-library-meta">
                <span className="asset-library-name" title={asset.path}>
                  {asset.name}
                </span>
                <span className={`asset-library-usage${asset.orphan ? " is-orphan" : ""}`}>
                  {asset.orphan ? "сирота" : `используется в ${asset.usageCount} местах`}
                </span>
              </div>
              {pickMode ? (
                <button
                  type="button"
                  className="asset-library-pick"
                  data-testid="asset-library-pick"
                  onClick={() => onPickAsset?.(asset.path)}
                >
                  выбрать
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
