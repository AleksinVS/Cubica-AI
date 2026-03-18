# Qdrant Indexing Pipeline

Цель: обеспечить семантический поиск по играм/узлам сценариев и фильтрацию по метаданным.

Событие публикации версии (`manifest_published`) инициирует индексирование:
- Извлекаются текстовые поля манифеста: `title`, `summary`, содержимое узлов.
- Вычисляются эмбеддинги и записываются в Qdrant c payload: `game_id`, `slug`, `version_id`, `tags`, `schema_version`.
- Для гибридного поиска фильтры (теги/категории) применяются на стороне БД/клиента, а близость — в Qdrant.

Файлы:
- `scripts/indexing/qdrant_indexer.py` — CLI-утилита upsert в Qdrant по событию.
- `docs/architecture/search/events/manifest_published.example.json` — пример события.

Пример запуска:
```
python scripts/indexing/qdrant_indexer.py \
  --url http://localhost:6333 \
  --collection games_manifests_v1 \
  --event docs/architecture/search/events/manifest_published.example.json
```

Замечания по эмбеддингам:
- В dev можно передавать уже посчитанные вектора в поле `vectors` события.
- В проде используйте внешний провайдер (например, сервис эмбеддингов) и прокидывайте вектор в этот индексатор.

Поля payload (минимум):
- `game_id`, `slug`, `version_id`, `title`, `tags`, `channel` (если применимо)

Удаление/депубликация:
- Отправляйте событие с `action: "delete"` и теми же ключами, чтобы удалить точки (`upsert` → `delete`).

