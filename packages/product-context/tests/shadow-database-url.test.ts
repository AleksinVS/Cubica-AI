import { describe, expect, it } from 'vitest';

import { safeShadowDatabaseUrl } from '../src/shadow-database-url.ts';

describe('shadow PostgreSQL URL boundary', () => {
  it.each([
    'postgres://localhost/shadow',
    'postgresql://127.0.0.1/shadow',
    'postgresql://[::1]/shadow',
    'postgresql://user:secret@db.internal/shadow?sslmode=verify-full'
  ])('accepts the exact safe form %s', (value) => {
    expect(safeShadowDatabaseUrl(value)).toBe(new URL(value).toString());
  });

  it.each([
    'postgresql://db.internal/shadow',
    'postgresql://db.internal/shadow?sslmode=require',
    'postgresql://db.internal/shadow?sslmode=verify-full&host=attacker.example',
    'postgresql://db.internal/shadow?host=attacker.example&sslmode=verify-full',
    'postgresql://db.internal/shadow?sslmode=verify-full&sslmode=disable',
    'postgresql://localhost/shadow?host=attacker.example',
    'postgresql://localhost/shadow?sslmode=verify-full',
    'postgresql:///shadow?sslmode=verify-full',
    'postgresql://%2Fvar%2Frun%2Fpostgresql/shadow?sslmode=verify-full',
    'postgresql://localhost/',
    'https://localhost/shadow'
  ])('rejects an ambiguous or redirectable form %s', (value) => {
    expect(safeShadowDatabaseUrl(value)).toBeNull();
  });
});
