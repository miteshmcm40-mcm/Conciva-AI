import { useEffect, useRef, useState } from 'react';

// One global Audio element shared across all voice tiles in the page so that
// clicking a different voice while one is playing stops the previous one.
let activeAudio = null;
const subscribers = new Set();
const broadcast = () => subscribers.forEach((fn) => fn(activeAudio));

export function useVoicePreview() {
  const [playingVoice, setPlayingVoice] = useState(null);
  const [error, setError] = useState('');
  const subscriberRef = useRef();

  useEffect(() => {
    const fn = (audio) => {
      if (!audio) {
        setPlayingVoice(null);
        return;
      }
      setPlayingVoice(audio.dataset?.voice || null);
    };
    subscriberRef.current = fn;
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);

  const stop = () => {
    if (activeAudio) {
      try { activeAudio.pause(); } catch {}
      activeAudio = null;
      broadcast();
    }
  };

  const play = async (voice, lang = 'en-US') => {
    setError('');
    // Same voice clicked again → toggle off.
    if (playingVoice === voice && activeAudio) {
      stop();
      return;
    }
    stop();
    const url = `/api/tts/sample/${encodeURIComponent(voice)}?lang=${encodeURIComponent(lang)}`;

    // Preflight the URL so we can read the real server error (audio elements
    // collapse all failures into "no supported source").
    let serverError = '';
    try {
      const head = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-0' } });
      if (!head.ok) {
        try { const j = await head.json(); serverError = j?.error || `HTTP ${head.status}`; }
        catch { serverError = `HTTP ${head.status}`; }
        setError(serverError);
        return;
      }
    } catch (e) {
      setError(e.message || 'Network error');
      return;
    }

    const audio = new Audio(url);
    audio.dataset.voice = voice;
    audio.dataset.lang = lang;
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      if (activeAudio === audio) {
        activeAudio = null;
        broadcast();
      }
    });
    audio.addEventListener('error', () => {
      if (activeAudio === audio) {
        activeAudio = null;
        broadcast();
        setError('Could not play the sample audio.');
      }
    });
    activeAudio = audio;
    broadcast();
    try {
      await audio.play();
    } catch (e) {
      activeAudio = null;
      broadcast();
      setError(e.message || 'Playback failed');
    }
  };

  return { playingVoice, error, play, stop };
}
