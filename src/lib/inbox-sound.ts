export const SOUND_MIN_INTERVAL_MS = 3_000;

/** Como máximo un sonido cada 3 s (spec §5.3). */
export function createSoundGate(now: () => number = () => Date.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < SOUND_MIN_INTERVAL_MS) return false;
    last = at;
    return true;
  };
}

type AudioContextConstructor = new () => AudioContext;

export type Chime = Readonly<{ unlock: () => void; play: (priority: 'URGENT' | 'HIGH') => void }>;

/**
 * Un tono corto sintetizado con Web Audio, sin archivos. El navegador sólo deja sonar audio después de un gesto
 * de la persona: `unlock()` crea el contexto en ese gesto y `play()` no suena hasta entonces.
 */
export function createChime(): Chime {
  let context: AudioContext | null = null;
  const gate = createSoundGate();
  return {
    unlock() {
      if (!context) {
        const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
        if (!Constructor) return;
        try {
          context = new Constructor();
        } catch {
          return;
        }
      }
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    },
    play(priority) {
      const audio = context;
      if (!audio || audio.state !== 'running' || !gate()) return;
      // Urgente: dos notas; alta: una.
      const notes = priority === 'URGENT' ? [880, 660] : [660];
      notes.forEach((frequency, index) => {
        const at = audio.currentTime + index * 0.16;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.3);
      });
    },
  };
}
