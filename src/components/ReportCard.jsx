import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Play, FileText, Sparkles, Clock, 
  DollarSign, BarChart3, Download, Share2, 
  MoreHorizontal, ChevronRight, Mic, Copy, Printer, Check,
  Target, Flag, Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AudioWavePlayer from './AudioWavePlayer.jsx';

// --- Configuration & Constants ---
const STATUS_CONFIG = {
  Completed: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: '●' },
  Missed: { bg: 'bg-amber-50 text-amber-700 border-amber-100', icon: '○' },
  Failed: { bg: 'bg-rose-50 text-rose-700 border-rose-100', icon: '✕' },
};

const SENTIMENT_CONFIG = {
  Positive: 'bg-emerald-500/10 text-emerald-600',
  Neutral: 'bg-slate-500/10 text-slate-600',
  Negative: 'bg-rose-500/10 text-rose-600',
};

const TRANSCRIPT_LANGUAGES = [
  { code: '', label: 'Original (English)' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'hi', label: 'Hindi' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
];

// --- Sub-Components ---

const MetricTile = ({ label, value, icon: Icon, colorClass }) => (
  <div className="group rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:bg-white hover:shadow-md">
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
      <Icon size={12} />
      {label}
    </div>
    <div className={`mt-2 text-lg font-bold tracking-tight ${colorClass || 'text-slate-900'}`}>
      {value}
    </div>
  </div>
);

const TabButton = ({ item, isActive, onClick, available, index = 0 }) => (
  <motion.button
    onClick={onClick}
    disabled={!available}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, delay: index * 0.06 }}
    className={`relative flex flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-300 ${
      isActive 
        ? 'border-indigo-600 bg-indigo-50/30 shadow-sm ring-1 ring-indigo-600' 
        : 'border-slate-200 bg-white hover:border-indigo-300 hover:-translate-y-0.5 hover:shadow-md'
    } ${!available && 'opacity-50 grayscale cursor-not-allowed'}`}
  >
    <div className="flex items-center justify-between">
      <div className={`rounded-lg p-2 transition-transform duration-300 ${isActive ? 'bg-indigo-600 text-white scale-105' : 'bg-slate-100 text-slate-500'}`}>
        {item.icon}
      </div>
      {isActive && (
        <motion.div layoutId="active-dot" className="relative h-2 w-2 rounded-full bg-indigo-600">
          <span className="absolute inset-0 rounded-full bg-indigo-500 animate-ping" />
        </motion.div>
      )}
    </div>
    <div>
      <p className="text-sm font-bold text-slate-900">{item.title}</p>
      <p className="text-xs text-slate-500 line-clamp-1">{item.subtitle}</p>
    </div>
  </motion.button>
);

// --- Main Component ---

export default function ReportCard({ record, transcript = [], summary = {} }) {
  const [activePanel, setActivePanel] = useState('recording');
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioPlayerRef = useRef(null);

  const [shareCopied, setShareCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);

  const [targetLang, setTargetLang] = useState('');
  const [translatedMap, setTranslatedMap] = useState({});
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState('');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${record.callId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch { /* clipboard unavailable — button still gives visual feedback */ }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const handleCopyCallId = async () => {
    try { await navigator.clipboard.writeText(record.callId); } catch { /* ignore */ }
    setMoreOpen(false);
  };

  const handlePrint = () => {
    setMoreOpen(false);
    window.print();
  };

  // Real machine translation via MyMemory's free, key-free translation API —
  // translates each transcript line from English into the picked language.
  // Results are cached per language so switching back doesn't re-fetch.
  const handleLanguageChange = async (code) => {
    setTargetLang(code);
    setTranslateError('');
    if (!code || translatedMap[code]) return;
    setTranslating(true);
    try {
      const results = await Promise.all(
        transcript.map((line) =>
          fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(line.text)}&langpair=en|${code}`)
            .then((r) => r.json())
            .then((data) => data?.responseData?.translatedText || line.text)
            .catch(() => line.text)
        )
      );
      setTranslatedMap((prev) => ({ ...prev, [code]: results }));
    } catch {
      setTranslateError('Translation failed. Please try again.');
    } finally {
      setTranslating(false);
    }
  };

  const translatedLines = targetLang ? translatedMap[targetLang] : null;

  const formatDuration = (seconds) => {
    const mins = Math.floor((seconds || 0) / 60);
    const secs = (seconds || 0) % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const panels = [
    { 
      key: 'recording', 
      title: 'Recording', 
      subtitle: 'Audio playback', 
      icon: <Mic size={16} />,
      available: record.recordingAvailable 
    },
    { 
      key: 'transcript', 
      title: 'Transcript', 
      subtitle: 'Full conversation text', 
      icon: <FileText size={16} />,
      available: record.transcriptAvailable 
    },
    { 
      key: 'summary', 
      title: 'AI Summary', 
      subtitle: 'Key takeaways', 
      icon: <Sparkles size={16} />,
      available: record.aiSummaryAvailable 
    },
  ];

  return (
    <article className="mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/50">
      {/* Top Header Section */}
      <div className="border-b border-slate-100 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">#{record.callId}</span>
              <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${STATUS_CONFIG[record.status]?.bg}`}>
                <span>{STATUS_CONFIG[record.status]?.icon}</span>
                {record.status}
              </div>
              <span className="text-xs font-medium text-slate-400">{record.callDate}</span>
            </div>
            
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              {record.callerName} <span className="text-slate-300 mx-2">→</span> {record.receiverNumber}
            </h1>
            
            <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
              <span className="flex items-center gap-1.5"><Mic size={14} /> {record.agentName}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{record.language}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span className="capitalize">{record.direction}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex">
            <MetricTile label="Duration" value={formatDuration(record.duration)} icon={Clock} />
            <MetricTile label="Cost" value={`$${record.callCost.toFixed(2)}`} icon={DollarSign} />
            <MetricTile 
              label="Sentiment" 
              value={record.sentiment} 
              icon={BarChart3} 
              colorClass={SENTIMENT_CONFIG[record.sentiment]} 
            />
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="grid lg:grid-cols-[340px_1fr]">
        {/* Left Sidebar: Navigation & Info */}
        <div className="animate-sidebar-pan border-r border-slate-100 p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2.5">
              {panels.map((p, i) => (
                <TabButton 
                  key={p.key} 
                  item={p} 
                  isActive={activePanel === p.key} 
                  onClick={() => setActivePanel(p.key)}
                  available={p.available}
                  index={i}
                />
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="rounded-2xl bg-gradient-to-br from-white to-orange-50/60 border border-orange-100 p-4 shadow-sm transition-all hover:shadow-md hover:border-orange-200"
            >
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Call Window</h4>
              <p className="mt-2 text-sm font-semibold text-slate-700">
                {new Date(record.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
                <span className="mx-2 text-slate-300">—</span>
                {new Date(record.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
              
              <hr className="my-3 border-orange-100" />
              
              <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Quick Insight</h4>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                The customer showed <span className="font-bold text-slate-900">{record.sentiment.toLowerCase()}</span> sentiment. 
                Interaction lasted {record.duration >= 60 ? `${Math.floor(record.duration / 60)} minutes` : `${record.duration} seconds`} via {record.agentName}.
              </p>
            </motion.div>
          </div>
        </div>

        {/* Right Content Area: Dynamic Display */}
        <div className="p-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePanel}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <div className="flex flex-col h-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                {/* Internal Panel Header */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-indigo-100 p-2 text-indigo-600">
                      {panels.find(p => p.key === activePanel)?.icon}
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 capitalize">{activePanel} View</h3>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleShare}
                      className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                      aria-label="Copy shareable link"
                      title={shareCopied ? 'Link copied!' : 'Copy shareable link'}
                    >
                      {shareCopied ? <Check size={18} className="text-emerald-500" /> : <Share2 size={18} />}
                    </button>
                    <div className="relative" ref={moreMenuRef}>
                      <button
                        onClick={() => setMoreOpen((o) => !o)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                        aria-label="More options"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {moreOpen && (
                        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                          <button
                            onClick={handleCopyCallId}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-orange-50 hover:text-orange-700"
                          >
                            <Copy size={14} /> Copy call ID
                          </button>
                          <button
                            onClick={handlePrint}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-orange-50 hover:text-orange-700"
                          >
                            <Printer size={14} /> Print report
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Content Logic */}
                <div className="flex-grow">
                  {activePanel === 'recording' && (
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-gradient-to-br from-[#F97316] via-[#FB923C] to-[#EA580C] p-4 text-white shadow-inner">
                         {record.audioFile ? (
                            <AudioWavePlayer ref={audioPlayerRef} record={record} onPlaybackRateChange={setPlaybackRate} />
                          ) : (
                            <div className="flex h-32 flex-col items-center justify-center gap-2 opacity-50">
                              <Mic size={32} />
                              <p className="text-sm">No recording available for this session</p>
                            </div>
                          )}
                      </div>
                      
                      <div className="flex flex-wrap gap-3">
                         <a
                           href={record.audioFile}
                           download={`recording-${record.callId}.mp3`}
                           aria-disabled={!record.audioFile}
                           onClick={(e) => { if (!record.audioFile) e.preventDefault(); }}
                           className={`flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white transition active:scale-95 ${
                             record.audioFile ? 'bg-slate-900 hover:bg-slate-800 cursor-pointer' : 'bg-slate-300 cursor-not-allowed'
                           }`}
                         >
                           <Download size={16} /> Download Audio
                         </a>
                         <button
                           type="button"
                           onClick={() => audioPlayerRef.current?.cyclePlaybackRate()}
                           disabled={!record.audioFile}
                           className={`flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-600 transition ${
                             record.audioFile ? 'hover:bg-slate-50' : 'opacity-50 cursor-not-allowed'
                           }`}
                         >
                           {playbackRate.toFixed(2)}x Speed
                         </button>
                      </div>
                    </div>
                  )}

                  {activePanel === 'transcript' && (
                    <div className="space-y-3">
                      {transcript.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Translate</span>
                          <select
                            value={targetLang}
                            onChange={(e) => handleLanguageChange(e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none transition focus:border-orange-400"
                          >
                            {TRANSCRIPT_LANGUAGES.map((l) => (
                              <option key={l.code || 'original'} value={l.code}>{l.label}</option>
                            ))}
                          </select>
                          {translating && <span className="text-xs text-slate-400">Translating…</span>}
                          {translateError && <span className="text-xs text-red-500">{translateError}</span>}
                        </div>
                      )}
                      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {transcript.length > 0 ? (
                          transcript.map((line, i) => (
                            <div key={i} className="flex gap-4 p-3 hover:bg-slate-50 rounded-xl transition">
                              <span className="text-[10px] font-bold text-slate-400 mt-1">{line.time}</span>
                              <div>
                                <p className="text-xs font-bold text-indigo-600 uppercase tracking-tighter">{line.speaker}</p>
                                <p className="mt-1 text-sm text-slate-700 leading-relaxed">{line.text}</p>
                                {targetLang && (
                                  <p className="mt-1.5 border-t border-orange-100 pt-1.5 text-sm italic leading-relaxed text-orange-700">
                                    {translating && !translatedLines ? 'Translating…' : (translatedLines?.[i] ?? line.text)}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-slate-400 text-center py-12">No transcript data available.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {activePanel === 'summary' && (
                    <div className="prose prose-slate max-w-none">
                      {summary?.gist ? (
                        <div className="space-y-4">
                          <div className="rounded-2xl bg-amber-50/50 border border-amber-100 p-6">
                            <h4 className="flex items-center gap-2 text-amber-800 font-bold mb-3">
                              <Sparkles size={16} /> AI Executive Summary
                            </h4>
                            <p className="text-sm leading-relaxed text-amber-900/80">{summary.gist}</p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            {summary.intent && (
                              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                  <Target size={12} /> Intent
                                </div>
                                <div className="mt-1 text-sm font-semibold text-slate-900">{summary.intent}</div>
                              </div>
                            )}
                            {summary.outcome && (
                              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                  <Flag size={12} /> Outcome
                                </div>
                                <div className="mt-1 text-sm font-semibold text-slate-900">{summary.outcome}</div>
                              </div>
                            )}
                            {summary.sentiment && (
                              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                  <BarChart3 size={12} /> Sentiment
                                </div>
                                <div className={`mt-1 text-sm font-semibold ${SENTIMENT_CONFIG[summary.sentiment]?.split(' ')[1] || 'text-slate-900'}`}>
                                  {summary.sentiment}
                                </div>
                              </div>
                            )}
                          </div>

                          {summary.actionItems?.length > 0 && (
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Action items</h4>
                              <ul className="grid gap-2">
                                {summary.actionItems.map((bp, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                                    <ChevronRight size={14} className="mt-1 text-amber-500 shrink-0" /> {bp}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {summary.keywords?.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Tag size={12} className="text-slate-400" />
                              {summary.keywords.map((kw) => (
                                <span key={kw} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {kw}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-amber-50/50 border border-amber-100 p-6">
                          <h4 className="flex items-center gap-2 text-amber-800 font-bold mb-3">
                            <Sparkles size={16} /> AI Executive Summary
                          </h4>
                          <p className="text-sm leading-relaxed text-amber-900/80">
                            The AI is processing the call summary. Please check back in a few moments.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </article>
  );
}