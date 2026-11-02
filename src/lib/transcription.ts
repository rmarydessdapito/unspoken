/**
 * Optional live transcription using the browser's Web Speech API.
 *
 * IMPORTANT (disclosed in the UI): in Chrome and Edge, speech recognition is processed by the browser
 * vendor's servers (Google / Microsoft). Safari may process on-device. The audio recording itself is
 * never uploaded by unspoken — only the browser's speech service hears the live microphone while
 * transcription is switched on. It is off by default.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function ctor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function transcriptionSupported(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

export class LiveTranscriber {
  private rec: SpeechRecognitionLike | null = null;
  private wanted = false;
  finalText = '';
  interim = '';
  onUpdate: ((finalText: string, interim: string) => void) | null = null;

  constructor(initial = '') {
    this.finalText = initial;
  }

  start() {
    const C = ctor();
    if (!C) return false;
    this.wanted = true;
    this.rec = new C();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.lang = navigator.language || 'en-US';
    this.rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText = `${this.finalText} ${r[0].transcript.trim()}`.trim();
        else interim += r[0].transcript;
      }
      this.interim = interim;
      this.onUpdate?.(this.finalText, this.interim);
    };
    this.rec.onerror = () => {
      /* "no-speech" etc — onend will restart while wanted */
    };
    // recognition sessions end on their own after silence; keep it going for long voicemails
    this.rec.onend = () => {
      if (this.wanted) {
        try {
          this.rec?.start();
        } catch {
          /* already started */
        }
      }
    };
    try {
      this.rec.start();
    } catch {
      return false;
    }
    return true;
  }

  pause() {
    this.wanted = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }

  resume() {
    if (!this.rec) return this.start();
    this.wanted = true;
    try {
      this.rec.start();
    } catch {
      /* ignore */
    }
    return true;
  }

  stop(): string {
    this.pause();
    this.rec = null;
    return `${this.finalText} ${this.interim}`.trim();
  }
}
