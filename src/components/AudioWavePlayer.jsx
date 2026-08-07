import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, Maximize2, Pause, Play, Volume2 } from 'lucide-react';
import { getToken } from '../api.js';

const formatTime = (value) => {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const playbackSpeeds = [0.75, 1, 1.25, 1.5, 2];

const buildAudioUrl = (source) => {
  if (!source) return null;
  if (source.startsWith('/api/')) {
    return `${source}${source.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`;
  }
  return source;
};

const BAR_COUNT = 64;

// Decorative bar-height pattern (0..1) matching the reference "sound wave"
// icon: tapering dotted ends with three spiky clusters (small, tallest,
// medium) separated by dips — not derived from real audio amplitude, since
// that icon shape isn't something actual waveform data looks like. Seeded
// by callId so each call gets a stable-but-slightly-different pattern
// instead of every recording looking pixel-identical.
const buildDecorativeWavePattern = (seedKey = '', barCount = BAR_COUNT) => {
  let seed = 0;
  for (let i = 0; i < seedKey.length; i++) seed = (seed * 31 + seedKey.charCodeAt(i)) % 100000;
  const rand = (n) => {
    const x = Math.sin(seed + n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  const clusters = [
    { center: 0.18, width: 0.09, peak: 0.55 },
    { center: 0.46, width: 0.13, peak: 1.0 },
    { center: 0.74, width: 0.10, peak: 0.62 },
  ];

  return Array.from({ length: barCount }, (_, i) => {
    const x = i / (barCount - 1);
    let h = 0.08;
    clusters.forEach(({ center, width, peak }) => {
      const d = (x - center) / width;
      const envelope = peak * Math.exp(-(d * d) * 3);
      const jitter = 0.65 + 0.35 * rand(i);
      h = Math.max(h, envelope * jitter);
    });
    const edgeFade = Math.min(1, x / 0.05, (1 - x) / 0.05);
    return Math.max(0.05, Math.min(1, h * Math.max(0.18, edgeFade)));
  });
};

const AudioWavePlayer = forwardRef(function AudioWavePlayer({ record, onPlaybackRateChange }, ref) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.82);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const wrapperRef = useRef(null);
  const audioRef = useRef(null);
  const gradientId = useId();

  const audioSource = record?.audioFile || record?.audioUrl;
  const audioUrl = buildAudioUrl(audioSource);

  const wavePattern = useMemo(
    () => buildDecorativeWavePattern(record?.callId || audioUrl || ''),
    [record?.callId, audioUrl]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    setLoadError(false);
    setCurrentTime(0);
    setDuration(0);

    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleError = () => {
      setLoadError(true);
      setDuration(0);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    audio.volume = muted ? 0 : volume;
    audio.playbackRate = playbackRate;

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    onPlaybackRateChange?.(playbackRate);
  }, [playbackRate, onPlaybackRateChange]);

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setLoadError(true));
    else audio.pause();
  };

  const seekTo = (percent) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const clamped = Math.min(1, Math.max(0, percent));
    audio.currentTime = clamped * duration;
    setCurrentTime(audio.currentTime);
  };

  const seekBySeconds = (delta) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, Math.max(0, audio.currentTime + delta));
    setCurrentTime(audio.currentTime);
  };

  const handleWaveFormSeek = (event) => {
    seekTo(Number(event.target.value) / 100);
  };

  const handleBarClick = (event) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const percent = (event.clientX - rect.left) / rect.width;
    seekTo(percent);
  };

  const handleVolumeChange = (event) => {
    setVolume(Number(event.target.value));
    setMuted(false);
  };

  const cyclePlaybackRate = () => {
    const nextIndex = (playbackSpeeds.indexOf(playbackRate) + 1) % playbackSpeeds.length;
    setPlaybackRate(playbackSpeeds[nextIndex]);
  };

  useImperativeHandle(ref, () => ({
    cyclePlaybackRate,
    get playbackRate() { return playbackRate; },
  }), [playbackRate]);

  const handleMute = () => {
    setMuted((current) => !current);
  };

  const handleFullscreen = async () => {
    if (!wrapperRef.current) return;
    if (document.fullscreenElement === wrapperRef.current) {
      await document.exitFullscreen();
      return;
    }
    await wrapperRef.current.requestFullscreen();
  };

  const handleKeyDown = (event) => {
    if (event.target !== wrapperRef.current && !wrapperRef.current.contains(event.target)) return;
    switch (event.key) {
      case ' ':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        event.preventDefault();
        seekBySeconds(event.shiftKey ? 10 : 5);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        seekBySeconds(-(event.shiftKey ? 10 : 5));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setVolume((current) => Math.min(1, current + 0.05));
        setMuted(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setVolume((current) => Math.max(0, current - 0.05));
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        handleMute();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        handleFullscreen();
        break;
      default:
        break;
    }
  };

  // SVG bar layout
  const barW = 2.4;
  const gap = 1.8;
  const step = barW + gap;
  const svgWidth = BAR_COUNT * step - gap;
  const svgHeight = 100;
  const progressIndex = duration > 0 ? (currentTime / duration) * BAR_COUNT : 0;
  const vividId = `${gradientId}-vivid`;
  const dimId = `${gradientId}-dim`;

  return (
    <section
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`rounded-[18px] border border-orange-300/40 bg-gradient-to-br from-[#F97316] via-[#FB923C] to-[#EA580C] p-3 shadow-xl shadow-orange-900/30 ring-1 ring-white/10 backdrop-blur-xl transition-shadow duration-500 animate-fade-up focus:outline-none focus:ring-2 focus:ring-white/50 ${isPlaying ? 'animate-player-breathe' : ''}`}
    >
      <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" className="hidden" />

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-[0.3em] text-white/80">AI Call Recording</p>
            <h2 className="mt-0.5 text-sm font-semibold text-white">{record.callId}</h2>
          </div>
          <div className="rounded-xl border border-white/20 bg-black/25 px-2.5 py-1 text-[11px] text-white/90">
            {formatTime(record.duration)} total
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[16px] border border-white/30 animate-orange-pan p-2 shadow-[inset_0_0_20px_rgba(194,65,12,0.18)]">
          <div className="pointer-events-none absolute inset-0 rounded-[16px] bg-black/10" />
          <div className="relative h-14">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              className="h-full w-full cursor-pointer"
              onClick={handleBarClick}
              aria-label="Audio waveform — click to seek"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
            >
              <defs>
                <linearGradient id={vividId} x1="0" y1="0" x2={svgWidth} y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#dc2626" />
                  <stop offset="0.35" stopColor="#ea580c" />
                  <stop offset="0.7" stopColor="#f97316" />
                  <stop offset="1" stopColor="#eab308" />
                </linearGradient>
                <linearGradient id={dimId} x1="0" y1="0" x2={svgWidth} y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#dc2626" stopOpacity="0.55" />
                  <stop offset="0.35" stopColor="#ea580c" stopOpacity="0.55" />
                  <stop offset="0.7" stopColor="#f97316" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#eab308" stopOpacity="0.55" />
                </linearGradient>
              </defs>
              {wavePattern.map((h, i) => {
                const barHeight = Math.max(4, h * svgHeight);
                const x = i * step;
                const y = (svgHeight - barHeight) / 2;
                const played = i <= progressIndex;
                return (
                  <rect
                    key={i}
                    x={x}
                    y={y}
                    width={barW}
                    height={barHeight}
                    rx={barW / 2}
                    fill={played ? `url(#${vividId})` : `url(#${dimId})`}
                  />
                );
              })}
            </svg>
            <div className={`pointer-events-none absolute inset-0 rounded-[14px] ${isPlaying ? 'animate-wave-glow-light' : ''}`} />
          </div>
          {isPlaying && (
            <div className="pointer-events-none absolute inset-0 rounded-[16px] animate-shimmer-sweep" />
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#EA580C] shadow-[0_10px_24px_-14px_rgba(0,0,0,0.6)] transition-transform duration-200 hover:-translate-y-0.5 hover:scale-[1.02]"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying && (
                <>
                  <span className="absolute inset-0 -z-10 rounded-xl bg-white/60 animate-ping" />
                  <span className="absolute -inset-1 -z-10 rounded-xl bg-white/25 animate-ping [animation-delay:0.3s]" />
                </>
              )}
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => seekBySeconds(-10)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/25 bg-black/25 text-white transition hover:-translate-y-0.5 hover:scale-[1.02]"
              aria-label="Seek backward 10 seconds"
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => seekBySeconds(10)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/25 bg-black/25 text-white transition hover:-translate-y-0.5 hover:scale-[1.02]"
              aria-label="Seek forward 10 seconds"
            >
              <ArrowRight className="h-3 w-3" />
            </button>
            <div className="ml-auto flex items-center gap-1.5 rounded-xl border border-white/25 bg-black/25 px-2 py-1 text-[11px] text-white/90">
              <Volume2 className="h-3.5 w-3.5 text-white" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="h-1.5 w-16 cursor-pointer appearance-none rounded-full bg-black/30 accent-white"
              />
            </div>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-[auto_1fr_auto] items-center text-[11px] text-white/80">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={duration > 0 ? (currentTime / duration) * 100 : 0}
              onChange={handleWaveFormSeek}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/30 accent-white"
            />
            <span>{formatTime(duration)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/90">
            <button
              type="button"
              onClick={cyclePlaybackRate}
              className="rounded-xl border border-white/25 bg-black/25 px-2 py-1 transition hover:-translate-y-0.5 hover:scale-[1.02]"
            >
              {playbackRate.toFixed(2)}x
            </button>
            <button
              type="button"
              onClick={handleMute}
              className="rounded-xl border border-white/25 bg-black/25 px-2 py-1 transition hover:-translate-y-0.5 hover:scale-[1.02]"
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              onClick={handleFullscreen}
              className="rounded-xl border border-white/25 bg-black/25 px-2 py-1 transition hover:-translate-y-0.5 hover:scale-[1.02]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <a
              href={record.audioFile}
              download={`recording-${record.callId}.mp3`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/20 px-2 py-1 text-white transition hover:bg-white/30"
            >
              <Download className="h-3.5 w-3.5" />
              Save
            </a>
          </div>
        </div>
      </div>
    </section>
  );
});

export default AudioWavePlayer;