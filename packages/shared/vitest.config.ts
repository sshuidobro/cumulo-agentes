import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'shared', include: ['tests/**/*.test.ts'], environment: 'node' } });
