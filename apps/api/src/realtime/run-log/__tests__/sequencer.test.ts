import { describe, it, expect } from 'vitest';

import { RealtimeSequencer } from '../sequencer';

describe('RealtimeSequencer', () => {
  it('assigns continuous seq per run starting at 1', () => {
    const sequencer = new RealtimeSequencer();

    expect(sequencer.next('run-1')).toBe(1);
    expect(sequencer.next('run-1')).toBe(2);
    expect(sequencer.next('run-1')).toBe(3);
  });

  it('keeps counters independent across runs', () => {
    const sequencer = new RealtimeSequencer();

    expect(sequencer.next('run-a')).toBe(1);
    expect(sequencer.next('run-b')).toBe(1);
    expect(sequencer.next('run-a')).toBe(2);
    expect(sequencer.next('run-b')).toBe(2);
  });

  it('current returns the last assigned seq, 0 for unseen runs', () => {
    const sequencer = new RealtimeSequencer();

    expect(sequencer.current('run-x')).toBe(0);
    sequencer.next('run-x');
    sequencer.next('run-x');
    expect(sequencer.current('run-x')).toBe(2);
  });

  it('reset reclaims the counter slot and restarts numbering from 1', () => {
    const sequencer = new RealtimeSequencer();

    sequencer.next('run-1');
    sequencer.next('run-1');
    expect(sequencer.size).toBe(1);

    sequencer.reset('run-1');
    expect(sequencer.size).toBe(0);
    expect(sequencer.current('run-1')).toBe(0);
    expect(sequencer.next('run-1')).toBe(1);
  });
});
