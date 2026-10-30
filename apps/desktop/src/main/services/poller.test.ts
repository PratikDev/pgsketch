import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startPoller } from './poller';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A fingerprint that is whatever the test says it is, and a record of how often it was read. */
function setup(interval = 1000) {
  const state = { value: 'a', reads: 0, fail: false };
  const onChange = vi.fn();
  const poller = startPoller(
    async () => {
      state.reads++;
      if (state.fail) throw new Error('broken');
      return state.value;
    },
    onChange,
    interval,
  );
  return { state, onChange, poller };
}
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('startPoller', () => {
  test('reads once at the start, and says nothing about it', async () => {
    const { state, onChange, poller } = setup();
    await poller.ready;
    expect(state.reads).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  test('reads again after each interval, and says nothing while it stays the same', async () => {
    const { state, onChange, poller } = setup();
    await tick(3500);
    expect(state.reads).toBe(4);
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  test('says so once for a change, and not again for the same one', async () => {
    const { state, onChange, poller } = setup();
    await tick(1000);
    state.value = 'b';
    await tick(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    await tick(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
    state.value = 'c';
    await tick(1000);
    expect(onChange).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  test('a change and back between two readings is not seen', async () => {
    const { state, onChange, poller } = setup();
    await tick(500);
    state.value = 'b';
    state.value = 'a';
    await tick(2000);
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  test('a reading that fails is skipped, the polling goes on, and the change after it is seen', async () => {
    const { state, onChange, poller } = setup();
    await tick(1000);
    state.fail = true;
    await tick(3000);
    expect(onChange).not.toHaveBeenCalled();
    state.fail = false;
    state.value = 'b';
    await tick(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  test('never reads twice at once: the next one waits for the last', async () => {
    let running = 0;
    let most = 0;
    const poller = startPoller(
      async () => {
        most = Math.max(most, ++running);
        await new Promise((r) => setTimeout(r, 2500));
        running--;
        return 'a';
      },
      vi.fn(),
      1000,
    );
    await tick(20_000);
    expect(most).toBe(1);
    poller.stop();
  });

  test('stops: no more readings, and a reading in progress is not acted on', async () => {
    const { state, onChange, poller } = setup();
    await tick(1000);
    const reads = state.reads;
    state.value = 'b';
    poller.stop();
    await tick(10_000);
    expect(state.reads).toBe(reads);
    expect(onChange).not.toHaveBeenCalled();
  });
});
