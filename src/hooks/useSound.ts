export function useSound() {
  const playSound = (
    freqs: number[],
    durations: number[],
    type: OscillatorType = 'sine',
    slide = false
  ) => {
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const audioCtx = new AudioCtxClass();
      let time = audioCtx.currentTime;

      freqs.forEach((freq, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, time);

        if (slide && index > 0) {
          osc.frequency.exponentialRampToValueAtTime(freq, time + durations[index]);
        }

        gain.gain.setValueAtTime(0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + durations[index]);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(time);
        osc.stop(time + durations[index]);

        time += durations[index] * 0.7; // overlap notes
      });
    } catch (e) {
      console.warn('Web Audio Context not supported or blocked:', e);
    }
  };

  const playCardSound = () => playSound([350, 480], [0.08, 0.08], 'triangle');
  const playDrawSound = () => playSound([200, 280, 360], [0.05, 0.05, 0.08], 'sine');
  const playUnoSound = () => playSound([392, 523, 659], [0.12, 0.12, 0.25], 'square');
  const playWinSound = () => playSound([523, 659, 784, 1047], [0.1, 0.1, 0.1, 0.35], 'sine');
  const playErrorSound = () => playSound([120, 90], [0.15, 0.25], 'sawtooth');

  return { playCardSound, playDrawSound, playUnoSound, playWinSound, playErrorSound };
}
