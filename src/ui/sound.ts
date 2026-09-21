/** Tiny chiptune sound effects made with the Web Audio API, no files. */

/** One step of a jingle: one or more frequencies played together, for a duration. 0 = rest. An optional third value glides the pitch to it by the end of the note. */
type Note = [freq: number | number[], ms: number, glideTo?: number];

// Pitches (Hz), equal temperament.
const N = {
  C4: 261.63, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, Ds5: 622.25, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B4b: 466.16,
  Eb3: 155.56, G3: 196.0, Bb3: 233.08, Db4: 277.18,
};

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
  for (const [freq, ms, glideTo] of notes) {
    for (const f of Array.isArray(freq) ? freq : [freq]) {
      if (f === 0) continue;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + ms / 1000);
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
  /** Beethoven, Symphony No. 3 "Eroica": two big E-flat chords, then the cello theme. A roll is a call to arms. */
  roll(): void {
    const chord = [N.Eb3, N.G3, N.Bb3, N.Eb4];
    play(
      [
        [chord, 200], [0, 60], [chord, 200], [0, 120],
        [N.Eb4, 170], [N.G4, 170], [N.Eb4, 170], [N.Bb3, 170], [N.Eb4, 520],
      ],
      'sawtooth',
      0.04,
    );
  },

  /** Someone else got there first: the Fifth's four notes, slow, with the last one sagging. Wah, wah. */
  lose(): void {
    play(
      [
        [N.G4, 260], [N.G4, 260], [N.G4, 260], [N.Eb4, 900, N.Db4],
      ],
      'sawtooth',
      0.05,
    );
  },

  /** Für Elise, the first five notes, as a soft menu chime. */
  menu(): void {
    play([[N.E5, 110], [N.Ds5, 110], [N.E5, 110], [N.Ds5, 110], [N.E5, 220]], 'triangle', 0.05);
  },

  /**
   * Ode to Joy (Symphony No. 9). A solve plays the first phrase; a personal
   * best plays both phrases and lands on a big chord.
   */
  win(personalBest = false): void {
    const q = 170; // quarter note
    const phrase1: Note[] = [
      [N.E5, q], [N.E5, q], [N.F5, q], [N.G5, q], [N.G5, q], [N.F5, q], [N.E5, q], [N.D5, q],
      [N.C5, q], [N.C5, q], [N.D5, q], [N.E5, q], [N.E5, q * 1.5], [N.D5, q * 0.5], [N.D5, q * 2],
    ];
    const phrase2: Note[] = [
      [N.E5, q], [N.E5, q], [N.F5, q], [N.G5, q], [N.G5, q], [N.F5, q], [N.E5, q], [N.D5, q],
      [N.C5, q], [N.C5, q], [N.D5, q], [N.E5, q], [N.D5, q * 1.5], [N.C5, q * 0.5],
      [[N.C5, N.E5, N.G5, N.C5 * 2], q * 4],
    ];
    play(personalBest ? [...phrase1, ...phrase2] : phrase1, 'square', 0.07);
  },
};
