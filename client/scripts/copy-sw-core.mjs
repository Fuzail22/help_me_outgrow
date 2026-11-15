// The service-worker core must be served from this site's own origin, so copy it out of the SDK package.
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const src = createRequire(import.meta.url).resolve('@notification-service/sdk/sw-core.js');
copyFileSync(src, new URL('../public/sw-core.js', import.meta.url));
console.log('copied sw-core.js from @notification-service/sdk');
