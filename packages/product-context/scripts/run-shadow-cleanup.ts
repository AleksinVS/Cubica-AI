#!/usr/bin/env node
/** Executable wrapper kept separate so the cleanup implementation stays import-safe. */
import { main } from './cleanup-shadow.ts';

process.exitCode = await main();
