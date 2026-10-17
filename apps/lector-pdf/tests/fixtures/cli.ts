import { ensureFixtures } from './ensure.ts';

const started = performance.now();
const { generated } = ensureFixtures({ force: process.argv.includes('--force') });
const seconds = ((performance.now() - started) / 1000).toFixed(2);
process.stdout.write(`Fixtures PDF: ${generated.length} generados en ${seconds} s\n`);
