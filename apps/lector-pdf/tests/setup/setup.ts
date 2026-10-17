import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installResizeObserver } from './resize-observer';

installResizeObserver();

afterEach(cleanup);
