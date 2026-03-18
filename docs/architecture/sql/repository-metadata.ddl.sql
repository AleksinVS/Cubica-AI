-- Cubica Repository Metadata Schema (PostgreSQL)
-- Stores metadata, version pointers and release channels for game manifests

create table if not exists games (
    id              uuid primary key default gen_random_uuid(),
    slug            text not null unique,
    title           text not null,
    owner           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists game_versions (
    id              uuid primary key default gen_random_uuid(),
    game_id         uuid not null references games(id) on delete cascade,
    version_id      text not null,                    -- content-addressed id (eg sha256 or ulid)
    schema_version  text not null default 'v1',
    manifest_key    text not null,                    -- object storage key (e.g., s3://bucket/games/{slug}/{versionId}/manifest.json)
    checksum        text not null,                    -- sha256 of manifest content
    size_bytes      bigint,
    created_at      timestamptz not null default now(),
    unique(game_id, version_id)
);

create index if not exists idx_game_versions_game on game_versions(game_id);

create table if not exists release_channels (
    id              uuid primary key default gen_random_uuid(),
    game_id         uuid not null references games(id) on delete cascade,
    name            text not null,
    unique(game_id, name)
);

create table if not exists channel_pointers (
    channel_id      uuid primary key references release_channels(id) on delete cascade,
    version_id      uuid not null references game_versions(id) on delete cascade,
    updated_at      timestamptz not null default now()
);

-- Optional tagging
create table if not exists tags (
    id              serial primary key,
    name            text not null unique
);

create table if not exists game_tags (
    game_id         uuid not null references games(id) on delete cascade,
    tag_id          int not null references tags(id) on delete cascade,
    primary key(game_id, tag_id)
);

-- Example view: resolve current version for a channel
create or replace view channel_current as
select rc.game_id, rc.name as channel, gv.version_id as version_key, gv.manifest_key, gv.checksum, cp.updated_at
from channel_pointers cp
join release_channels rc on rc.id = cp.channel_id
join game_versions gv on gv.id = cp.version_id;

