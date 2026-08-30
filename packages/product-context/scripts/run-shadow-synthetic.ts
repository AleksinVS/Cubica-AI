#!/usr/bin/env node
import {
  preflightSyntheticShadowActivation,
  runSyntheticShadowActivation,
  syntheticShadowActivationConfig
} from '../src/shadow-activation-harness.ts';

async function main(): Promise<void> {
  const [mode, ...flags] = process.argv.slice(2);
  if ((mode !== 'preflight' && mode !== 'run') || flags.length !== 2 ||
      !flags.includes('--synthetic-only') || !flags.includes('--deny-external-processing')) throw new Error();
  const config = syntheticShadowActivationConfig(process.env);
  const result = mode === 'preflight'
    ? await preflightSyntheticShadowActivation(config)
    : await runSyntheticShadowActivation(config);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(() => {
  process.stderr.write('Synthetic shadow activation rehearsal was refused.\n');
  process.exitCode = 1;
});
