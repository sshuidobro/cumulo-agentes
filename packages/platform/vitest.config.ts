import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'platform', include: ['tests/**/*.test.ts'], environment: 'jsdom' } });
