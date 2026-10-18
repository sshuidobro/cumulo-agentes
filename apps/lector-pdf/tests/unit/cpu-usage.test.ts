import { describe, expect, it } from 'vitest';
import {
  busyFraction,
  cpuSample,
  parseTopSnapshot,
  waitForCpuRest,
  type CpuSample,
} from '../e2e/cpu-usage.ts';

describe('cpuSample', () => {
  it('suma idle y total de todos los núcleos', () => {
    const cores = [
      { times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } },
      { times: { user: 30, nice: 0, sys: 10, idle: 60, irq: 0 } },
    ];
    expect(cpuSample(cores)).toEqual({ idle: 145, total: 200 });
  });
});

describe('busyFraction', () => {
  it('calcula la fracción ocupada entre dos muestras', () => {
    expect(busyFraction({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBeCloseTo(0.75, 10);
  });

  it('devuelve 0 si no ha pasado tiempo total', () => {
    expect(busyFraction({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBe(0);
  });

  it('recorta a 0 si el idle crece más que el total (dato raro)', () => {
    expect(busyFraction({ idle: 100, total: 200 }, { idle: 400, total: 300 })).toBe(0);
  });
});

/** Reloj falso: `sleep` avanza el reloj y no espera de verdad. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

/** Muestras acumuladas tales que la fracción ocupada entre llamadas consecutivas sea `busy[k]`. */
function fakeSampler(busy: readonly number[]): () => CpuSample {
  let calls = 0;
  let total = 0;
  let idle = 0;
  return () => {
    if (calls === 0) {
      calls++;
      return { idle: 0, total: 0 };
    }
    const fraction = busy[calls - 1] ?? busy[busy.length - 1] ?? 1;
    calls++;
    total += 1000;
    idle += 1000 * (1 - fraction);
    return { idle, total };
  };
}

describe('waitForCpuRest', () => {
  it('termina cuando hay ventanas consecutivas por debajo del máximo', async () => {
    const clock = fakeClock();
    const result = await waitForCpuRest({
      maxBusy: 0.15,
      windowMs: 1000,
      consecutive: 3,
      timeoutMs: 60_000,
      sample: fakeSampler([0.5, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1]),
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(result.reached).toBe(true);
    expect(result.waitedMs).toBe(7000);
    expect(result.lastBusy).toBeCloseTo(0.1, 10);
  });

  it('informa de no alcanzado al agotar el tiempo', async () => {
    const clock = fakeClock();
    const result = await waitForCpuRest({
      maxBusy: 0.15,
      windowMs: 1000,
      consecutive: 3,
      timeoutMs: 5000,
      sample: fakeSampler([0.5]),
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(result.reached).toBe(false);
    expect(result.waitedMs).toBe(5000);
    expect(result.lastBusy).toBeCloseTo(0.5, 10);
  });
});

describe('parseTopSnapshot', () => {
  const header = '  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND';

  it('devuelve las 5 primeras filas del segundo bloque', () => {
    const text = [
      'top - 10:00:00 up 1 day,  1 user,  load average: 1.00, 1.00, 1.00',
      'Tasks: 300 total',
      header,
      '  1 root      20   0  100  10  10 S   1.0   0.1   0:01.00 init',
      'top - 10:00:01 up 1 day,  1 user,  load average: 1.00, 1.00, 1.00',
      'Tasks: 300 total',
      header,
      ' 900 user      20   0  900  90  90 R  55.7   1.0   0:10.00 headless_shell',
      ' 901 user      20   0  900  90  90 S  12.0   1.0   0:10.00 node vite preview',
      ' 902 user      20   0  900  90  90 S   3.0   1.0   0:10.00 chrome',
      ' 903 user      20   0  900  90  90 S   2.0   1.0   0:10.00 bash',
      ' 904 user      20   0  900  90  90 S   1.0   1.0   0:10.00 sleep',
      ' 905 user      20   0  900  90  90 S   0.5   1.0   0:10.00 cat',
    ].join('\n');
    expect(parseTopSnapshot(text)).toEqual([
      '55.7 headless_shell',
      '12.0 node vite preview',
      '3.0 chrome',
      '2.0 bash',
      '1.0 sleep',
    ]);
  });

  it('devuelve [] si no hay segundo bloque', () => {
    const text = ['top - 10:00:00 up 1 day', header, ' 1 root 20 0 1 1 1 S 1.0 0.1 0:01.00 init'].join('\n');
    expect(parseTopSnapshot(text)).toEqual([]);
  });
});
