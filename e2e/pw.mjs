// Resolves Playwright whether it is installed in this folder or globally (NODE_PATH).
import { createRequire } from 'node:module';
export const { chromium, devices } = createRequire(import.meta.url)('playwright');
