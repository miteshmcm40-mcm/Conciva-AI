import React, { useState, useMemo, useEffect } from 'react';
import { 
  Mic, Search, Filter, RefreshCw, 
  ChevronDown, FileText, BarChart3, 
  Download, AlertCircle, Calendar,
  Clock, PhoneIncoming, PhoneOutgoing 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getToken } from '../../api.js';
import { useApp } from '../../AppContext.jsx';

// --- Components ---
import CallDetailModal from '../../components/CallDetailModal.jsx';
import DateRangePicker, { todayRange } from '../../components/DateRangePicker.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

// --- Utilities (Types/Formatting) ---
const formatters = {
  phone: (s) => {
    if (!s) return '—';
    const m = String(s).match(/sip:([^@;]+)/);
    return m ? m[1] : s;
  },
  duration: (s) => {
    const mins = Math.floor((s || 0) / 60);
    const secs = (s || 0) % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  },
  relativeTime: (t) => {
    if (!t) return '—';
    const d = new Date(t);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
};

/**
 * Hook to manage the complex state of recordings and filters
 */
function useRecordingsManager(currentUser) {
  const [data, setData] = useState({ items: [], numbers: [], loading: true, error: null });
  const [filters, setFilters] = useState({ 
    number: 'all', 
    search: '', 
    range: todayRange() 
  });

  const load = async (force = false) => {
    setData(prev => ({ ...prev, loading: true }));
    try {
      const [recsRes, numbersRes] = await Promise.all([
        api(`/api/recordings?limit=500${force ? '&refresh=1' : ''}`),
        api('/api/numbers').catch(() => ({ numbers: [] })),
      ]);
      const result = {
        items: recsRes.recordings || [],
        numbers: numbersRes.numbers || [],
        loading: false,
        error: null
      };
      setData(result);
      writeCache('recordings.recordings', currentUser?.id, result.items);
    } catch (e) {
      setData(prev => ({ ...prev, loading: false, error: e.message }));
    }
  };

  const filteredItems = useMemo(() => {
    const { from, to } = filters.range;
    const fromTs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
    const toTs = to ? new Date(to + 'T23:59:59.999').getTime() : Infinity;
    const searchClean = filters.search.replace(/\D+/g, '');

    return data.items.filter(r => {
      const ts = new Date(r.startTime).getTime();
      if (ts < fromTs || ts > toTs) return false;
      
      if (filters.number !== 'all') {
        const dTo = r.to.replace(/\D+/g, '');
        const dFrom = r.from.replace(/\D+/g, '');
        if (!dTo.includes(filters.number) && !dFrom.includes(filters.number)) return false;
      }

      if (searchClean) {
        if (!r.from.includes(searchClean) && !r.to.includes(searchClean)) return false;
      }
      return true;
    });
  }, [data.items, filters]);

  return { data, filters, setFilters, filteredItems, refresh: () => load(true), loadInitial: load };
}

// --- Sub-Components ---

const AudioPlayer = ({ url, callId, onRefresh }) => {
  const [error, setError] = useState(false);
  const src = `${url}?token=${encodeURIComponent(getToken())}`;

  if (error) return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
      <AlertCircle size={14} />
      <span>Recording processing or unavailable.</span>
      <button onClick={onRefresh} className="font-bold underline">Retry</button>
    </div>
  );

  return (
    <div className="group relative flex w-full max-w-md items-center gap-3 rounded-2xl bg-slate-100 p-2 transition-colors hover:bg-slate-200/70">
      <audio 
        controls 
        className="h-8 w-full" 
        src={src} 
        onError={() => setError(true)}
        preload="none"
      />
    </div>
  );
};

const RecordingCard = ({ record, onOpenDetails }) => {
  const [isExpanded, setIsExpanded] = useState({ transcript: false, summary: false });
  const isOutbound = record.direction?.includes('outbound');

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Main Info */}
          <div className="flex-1 space-y-2 cursor-pointer" onClick={() => onOpenDetails(record)}>
            <div className="flex items-center gap-3">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${isOutbound ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {isOutbound ? <PhoneOutgoing size={14} /> : <PhoneIncoming size={14} />}
              </span>
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {formatters.phone(record.from)} 
                  <span className="mx-2 text-slate-300">→</span> 
                  {formatters.phone(record.to)}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                  <span className="flex items-center gap-1"><Clock size={12}/> {formatters.relativeTime(record.startTime)}</span>
                  <span>•</span>
                  <span>{formatters.duration(record.duration)}</span>
                  {record.agentName && (
                    <><span className="h-1 w-1 rounded-full bg-slate-200" /><span>{record.agentName}</span></>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button 
              onClick={() => setIsExpanded(p => ({ ...p, summary: !p.summary }))}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${isExpanded.summary ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <BarChart3 size={14} className="inline mr-1" /> AI Summary
            </button>
            {record.hasTranscript && (
              <button 
                onClick={() => setIsExpanded(p => ({ ...p, transcript: !p.transcript }))}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${isExpanded.transcript ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                <FileText size={14} className="inline mr-1" /> Transcript
              </button>
            )}
          </div>
        </div>

        {/* Audio Section */}
        {record.audioUrl && (
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-slate-50 pt-4">
            <AudioPlayer url={record.audioUrl} callId={record.callId} />
            <a 
              href={`${record.audioUrl}?token=${encodeURIComponent(getToken())}&download=1`}
              className="text-slate-400 hover:text-indigo-600 transition"
              title="Download MP4"
            >
              <Download size={18} />
            </a>
          </div>
        )}
      </div>

      {/* Expandable Panels */}
      <AnimatePresence>
        {isExpanded.summary && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="bg-slate-50 border-t border-slate-100">
             <div className="p-5 text-sm text-slate-600 italic">
               Loading AI generated insights...
               {/* Replace with actual SummaryContent component */}
             </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default function Recordings() {
  const { currentUser } = useApp();
  const manager = useRecordingsManager(currentUser);
  const [openRec, setOpenRec] = useState(null);

  useEffect(() => {
    manager.loadInitial();
  }, []);

  if (!currentUser) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Recordings</h1>
          <p className="mt-1 text-slate-500 font-medium">Quality assurance and AI insights for every interaction.</p>
        </div>
        <button 
          onClick={manager.refresh}
          disabled={manager.data.loading}
          className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-bold shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={manager.data.loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {/* Unified Filter Bar */}
      <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Search by number..."
              className="w-full rounded-2xl border-none bg-transparent py-3 pl-12 pr-4 text-sm focus:ring-0"
              value={manager.filters.search}
              onChange={(e) => manager.setFilters(f => ({ ...f, search: e.target.value }))}
            />
          </div>
          
          <div className="h-8 w-px bg-slate-100 hidden md:block" />

          <DateRangePicker
            from={manager.filters.range.from}
            to={manager.filters.range.to}
            onChange={(range) => manager.setFilters(f => ({ ...f, range }))}
            className="border-none bg-transparent shadow-none"
          />

          <select
            className="rounded-2xl border-none bg-slate-50 py-2 pl-4 pr-10 text-sm font-bold text-slate-700 focus:ring-0"
            value={manager.filters.number}
            onChange={(e) => manager.setFilters(f => ({ ...f, number: e.target.value }))}
          >
            <option value="all">All Lines</option>
            {manager.data.numbers.map(n => (
              <option key={n.id} value={n.value}>{n.label || n.value}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Main List */}
      <main className="space-y-4">
        {manager.data.loading && manager.filteredItems.length === 0 ? (
          Array(3).fill(0).map((_, i) => (
            <div key={i} className="h-32 w-full animate-pulse rounded-2xl bg-slate-100" />
          ))
        ) : manager.filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-slate-50 p-6 text-slate-300">
              <Mic size={48} />
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">No recordings found</h3>
            <p className="text-slate-500">Try adjusting your filters or date range.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {manager.filteredItems.map(r => (
              <RecordingCard 
                key={r.callId} 
                record={r} 
                onOpenDetails={setOpenRec} 
              />
            ))}
          </div>
        )}
      </main>

      {/* Modal */}
      {openRec && (
        <CallDetailModal
          call={openRec}
          onClose={() => setOpenRec(null)}
        />
      )}
    </div>
  );
}