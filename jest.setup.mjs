import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

globalThis.jest = jest;
globalThis.require = createRequire(import.meta.url);
