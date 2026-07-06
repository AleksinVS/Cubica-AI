/**
 * Точка входа пакета @cubica/view-protocol.
 *
 * Пакет содержит framework-agnostic (не зависящие от UI-фреймворка) контракты
 * и утилиты, разделяемые каналами доставки Cubica:
 * - Abstract View Protocol (ADR-002) — команды Presenter -> View;
 * - утилиты применения JSON-патчей состояния (RFC 7396 / RFC 6902).
 *
 * История: код перенесён из бывшего SDK/core по ADR-064 (стратегия
 * «headless core + адаптеры каналов»). Мёртвая сессионная заготовка
 * (createSession) удалена: транспортный клиент живёт в Presenter-слое
 * канала и в перспективе генерируется из OpenAPI-контракта (ADR-051).
 */

export * from './view-protocol.ts';
export * from './state.ts';
