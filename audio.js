/**
 * LuminaMed - Web Audio API Synthesizer & Alarm Engine
 * Provides crystal-clear procedural chime melodies without any external audio asset dependencies.
 */

class LuminaAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.volume = 0.8;
    this.activeAlarmLoop = null;
    this.isPlaying = false;

    // Speech Synthesis configuration
    this.speechEnabled = true;
    this.speechRate = 0.95; // Gentle, clear pacing for elderly and vision-impaired patients
    this.speechPitch = 1.0;
    this.voicesLoaded = false;
    this.selectedVoice = null;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.loadBestVoice();
      };
      this.loadBestVoice();
    }
  }

  loadBestVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;
    this.voicesLoaded = true;

    // Prefer high-clarity natural English voices
    const preferred = voices.find(v => 
      v.lang.startsWith('en') && 
      (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Zira') || v.name.includes('Jenny') || v.name.includes('David'))
    ) || voices.find(v => v.lang.startsWith('en'));

    if (preferred) {
      this.selectedVoice = preferred;
    }
  }

  setSpeechEnabled(enabled) {
    this.speechEnabled = Boolean(enabled);
    if (!this.speechEnabled) {
      this.stopSpeech();
    }
  }

  setSpeechRate(rate) {
    this.speechRate = Math.max(0.6, Math.min(1.5, rate));
  }

  stopSpeech() {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
  }

  /**
   * Speak arbitrary text with natural cadence
   */
  speak(text) {
    if (!('speechSynthesis' in window) || !this.speechEnabled || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = this.speechRate;
      utter.pitch = this.speechPitch;
      utter.volume = Math.max(0.3, this.volume);
      if (this.selectedVoice) utter.voice = this.selectedVoice;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  }

  /**
   * Speak structured medication reminder aloud with dosage & food directions
   */
  speakMedicationReminder({ medName, dosage, instructions, mealTiming, patientName }) {
    if (!('speechSynthesis' in window) || !this.speechEnabled || !medName) return;

    const patientGreeting = patientName ? `Attention ${patientName}, ` : 'Attention, ';
    const foodNote = mealTiming && mealTiming !== 'Any time' ? `. Food instruction: ${mealTiming}` : '';
    const instructionNote = instructions && instructions.trim() ? `. Doctor's note: ${instructions}` : '';

    const speechText = `${patientGreeting}it is time for your medication: ${medName}, dosage: ${dosage}${foodNote}${instructionNote}. Please take it with a full glass of water.`;

    // Slight delay so the opening bell chime can ring clearly first
    setTimeout(() => {
      this.speak(speechText);
    }, 600);
  }

  /**
   * Test speech preview
   */
  testSpeech(patientName = 'Alex') {
    this.speakMedicationReminder({
      medName: 'Metformin',
      dosage: '500 milligrams',
      instructions: 'Take 1 tablet after meals',
      mealTiming: 'After food',
      patientName: patientName
    });
  }

  // Ensure AudioContext is initialized on user interaction (browser policy)
  initContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setVolume(normalizedVal) {
    this.volume = Math.max(0, Math.min(1, normalizedVal));
  }

  /**
   * Play a specific chime tone
   * @param {string} soundName - 'crystalBell' | 'harpChord' | 'pulseBeep' | 'zenBowl'
   */
  playSound(soundName = 'crystalBell') {
    this.initContext();
    if (!this.audioCtx) return;

    switch (soundName) {
      case 'harpChord':
        this.playHarpChord();
        break;
      case 'pulseBeep':
        this.playPulseBeep();
        break;
      case 'zenBowl':
        this.playZenBowl();
        break;
      case 'crystalBell':
      default:
        this.playCrystalBell();
        break;
    }
  }

  // 1. Crystal Medical Bell (Crisp, gentle, harmonic chime)
  playCrystalBell() {
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    
    // Notes: E5 (659.25 Hz) then A5 (880 Hz) then C#6 (1108.73 Hz)
    const notes = [
      { freq: 659.25, time: 0.0, dur: 1.2 },
      { freq: 880.00, time: 0.18, dur: 1.4 },
      { freq: 1108.73, time: 0.36, dur: 1.8 }
    ];

    notes.forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.time);

      // Gentle harmonic overtone for chime shimmer
      const overtone = ctx.createOscillator();
      const overtoneGain = ctx.createGain();
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(note.freq * 2.756, now + note.time);

      const baseVol = this.volume * 0.45;
      gain.gain.setValueAtTime(0.0001, now + note.time);
      gain.gain.exponentialRampToValueAtTime(baseVol, now + note.time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.dur);

      overtoneGain.gain.setValueAtTime(0.0001, now + note.time);
      overtoneGain.gain.exponentialRampToValueAtTime(baseVol * 0.18, now + note.time + 0.015);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + note.time + (note.dur * 0.5));

      osc.connect(gain);
      overtone.connect(overtoneGain);

      gain.connect(ctx.destination);
      overtoneGain.connect(ctx.destination);

      osc.start(now + note.time);
      overtone.start(now + note.time);

      osc.stop(now + note.time + note.dur);
      overtone.stop(now + note.time + note.dur);
    });
  }

  // 2. Harp Chord Arpeggio (Warm, soothing, waking tone)
  playHarpChord() {
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    // C Major 9 chord arpeggio: C5, E5, G5, B5, D6
    const freqs = [523.25, 659.25, 783.99, 987.77, 1174.66];
    
    freqs.forEach((freq, idx) => {
      const startTime = now + (idx * 0.12);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle'; // warm acoustic feel
      osc.frequency.setValueAtTime(freq, startTime);

      const noteVol = this.volume * 0.35;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(noteVol, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.25);
    });
  }

  // 3. Digital Health Pulse (High clarity rhythmic chime)
  playPulseBeep() {
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const pulses = [0, 0.22, 0.44];
    pulses.forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.50, now + offset); // C6
      osc.frequency.exponentialRampToValueAtTime(1318.51, now + offset + 0.1); // E6

      const pulseVol = this.volume * 0.4;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(pulseVol, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  }

  // 4. Zen Bowl & Resonator (Deep calming reverberant tone)
  playZenBowl() {
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    const fundamental = 432; // Calming frequency
    const partials = [
      { mult: 1, gain: 0.5, dur: 2.5 },
      { mult: 2.76, gain: 0.25, dur: 1.8 },
      { mult: 5.4, gain: 0.1, dur: 1.0 }
    ];

    partials.forEach(p => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(fundamental * p.mult, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(this.volume * p.gain, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + p.dur);
    });
  }

  /**
   * Start looping alarm chime for an active dose alert
   * Rings every 4 seconds until stopped
   */
  startContinuousAlarm(soundName = 'crystalBell') {
    this.stopContinuousAlarm();
    this.isPlaying = true;
    
    // Play immediately
    this.playSound(soundName);

    // Repeat every 3.5 seconds
    this.activeAlarmLoop = setInterval(() => {
      if (this.isPlaying) {
        this.playSound(soundName);
      }
    }, 3500);
  }

  /**
   * Stop any actively looping alarm sound
   */
  stopContinuousAlarm() {
    this.isPlaying = false;
    if (this.activeAlarmLoop) {
      clearInterval(this.activeAlarmLoop);
      this.activeAlarmLoop = null;
    }
  }
}

// Global singleton instance
window.luminaAudio = new LuminaAudioEngine();
