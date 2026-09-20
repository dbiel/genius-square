/** Tiny chiptune sound effects made with the Web Audio API, no files. */

type Note = [freq: number, ms: number];

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
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
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
  roll(): void {
    play([[200, 40], [260, 40], [320, 40], [400, 40], [520, 60]], 'square', 0.05);
  },
  win(): void {
    play([[523, 110], [659, 110], [784, 110], [1047, 220], [784, 110], [1047, 320]], 'square', 0.09);
  },
};
