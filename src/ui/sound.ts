/** Tiny chiptune sound effects made with the Web Audio API, no files. */

/** One step of a jingle: one or more frequencies played together, for a duration. */
type Note = [freq: number | number[], ms: number];

let ctx: AudioContext | null = null;
let muted = false;

function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function play(notes: Note[], type: OscillatorType = 'square', gain = 0.08): void {
  if (muted) return;
  const ac = context();
  if (!ac) return;
  let t = ac.currentTime;
  for (const [freq, ms] of notes) {
    for (const f of Array.isArray(freq) ? freq : [freq]) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
      osc.connect(g).connect(ac.destination);
      osc.start(t);
      osc.stop(t + ms / 1000);
    }
    t += ms / 1000;
  }
}

export const sound = {
  setMuted(value: boolean): void {
    muted = value;
  },
  isMuted(): boolean {
    return muted;
  },
  /** Unlock audio on the first user gesture (iOS needs this). */
  unlock(): void {
    context();
  },
  pickUp(): void {
    play([[440, 40], [660, 50]]);
  },
  drop(): void {
    play([[330, 50], [220, 70]]);
  },
  rotate(): void {
    play([[520, 35]], 'triangle', 0.06);
  },
  error(): void {
    play([[180, 90], [140, 140]], 'sawtooth', 0.06);
  },
  /** Herald's fanfare for a new roll: doo, doo, doo, doooo (C5 C5 C5 G5). Brassy sawtooth. */
  roll(): void {
    play(
      [
        [523, 140],
        [523, 140],
        [523, 140],
        [[784, 392], 650],
      ],
      'sawtooth',
      0.045,
    );
  },
  /**
   * Zelda-style "item get" fanfare: da, da, da, DAAAA. Three quick rising notes
   * (G4 A4 B4) into a held C major chord. Tune the numbers here to taste.
   */
  win(): void {
    play(
      [
        [392, 130],
        [440, 130],
        [494, 130],
        [[523, 659, 784, 1047], 1100],
      ],
      'square',
      0.07,
    );
  },
};
