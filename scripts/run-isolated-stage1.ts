/** Manual entrypoint for the isolated, synthetic-only Stage 1 smoke flow. */
import { runSyntheticSmoke } from '../packages/product-context/src/harness.ts';

const result = await runSyntheticSmoke({
  databaseUrl: process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL ?? '',
  gitRoot: process.env.PRODUCT_CONTEXT_STAGE1_GIT_ROOT ?? '',
  syntheticOnly: process.argv.includes('--synthetic-only'),
  denyExternalProcessing: process.argv.includes('--deny-external-processing')
});

// Report only bounded outcomes. Message bodies, database credentials and
// repository contents are deliberately never logged.
console.log(`Synthetic Stage 1 smoke completed: remembered=${result.remembered} corrected=${result.corrected} forgotten=${result.forgotten} commits=${result.semanticCommits}`);
