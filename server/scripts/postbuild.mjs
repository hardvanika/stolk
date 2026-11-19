// dist/ must be copyable on its own, so it carries its own package.json marking the files as ES modules.
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/package.json', import.meta.url), JSON.stringify({ type: 'module' }) + '\n');
