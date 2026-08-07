import { useEffect, useMemo, useState, useRef } from 'react';
import { ChevronDown, X, SlidersHorizontal, Download, RefreshCw, Search, Calendar, User, Globe, Phone } from 'lucide-react';
import SearchBar from './SearchBar.jsx';
import ExportButton from './ExportButton.jsx';

const presets = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'custom', label: 'Custom range' },
];

function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function FilterBar({
  values,
  onPresetChange,
  onDateChange,
  onSearchChange,
  onFieldChange,
  onExport,
  agents = [],
  languages = [],
  statuses = [],
  total = 0,
  isLoading = false,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  const activePreset = useMemo(() => presets.find((p) => p.id === values.preset)?? presets[2], [values.preset]);
  const debouncedSearch = useDebounce(values.search, 400);

  useEffect(() => {
    if (debouncedSearch!== values.search) onSearchChange(debouncedSearch);
  }, [debouncedSearch, values.search, onSearchChange]);

  useEffect(() => {
    const handleClick = (e) => exportRef.current &&!exportRef.current.contains(e.target) && setExportOpen(false);
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const activeChips = useMemo(() => {
    const chips = [];
    if (values.status!== 'all') chips.push({ key: 'status', label: `Status: ${values.status}` });
    if (values.language!== 'all') chips.push({ key: 'language', label: `Lang: ${values.language}` });
    if (values.agent!== 'all') chips.push({ key: 'agent', label: `Agent: ${values.agent}` });
    if (values.caller) chips.push({ key: 'caller', label: `Caller: ${values.caller}` });
    if (values.from || values.to) chips.push({ key: 'date', label: `${values.from || '...'} → ${values.to || '...'}` });
    return chips;
  }, [values]);

  const clearAll = () => {
    onFieldChange('status', 'all');
    onFieldChange('language', 'all');
    onFieldChange('agent', 'all');
    onFieldChange('caller', '');
    onDateChange('from', '');
    onDateChange('to', '');
    onSearchChange('');
    onPresetChange('last7');
  };

  return (
    <>
      <section className="filter-section fade-in">
        {/* Header */}
        <div className="header">
          <div className="header-left">
            <div className="header-top">
              <p className="label">Filters</p>
              <span className="badge">{isLoading? '...' : total.toLocaleString()} results</span>
            </div>
            <h1>Calls reports</h1>
            <p className="subtitle">
              Explore every voice call with transcript, AI summaries, sentiment tracking, and exporting for your team.
            </p>
          </div>

          <div className="header-actions">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="btn-secondary mobile-only">
              <SlidersHorizontal size={16} /> Filters
              {activeChips.length > 0 && <span className="badge-dot">{activeChips.length}</span>}
            </button>

            <div className="relative" ref={exportRef}>
              <button onClick={() => setExportOpen(!exportOpen)} className="btn-secondary">
                <Download size={16} /> Export
                <ChevronDown size={14} className="chevron" style={{ transform: exportOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>
              {exportOpen && (
                <div className="dropdown">
                  <button onClick={() => { onExport('csv'); setExportOpen(false); }}>Export CSV</button>
                  <button onClick={() => { onExport('pdf'); setExportOpen(false); }}>Export PDF</button>
                </div>
              )}
            </div>

            <button onClick={() => onPresetChange('last7')} className="btn-primary">
              <RefreshCw size={16} className="refresh-icon" /> Refresh
            </button>
          </div>
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="chips-wrap">
            {activeChips.map((c, i) => (
              <span key={c.key} className="chip" style={{ animationDelay: `${i * 60}ms` }}>
                {c.label}
                <button onClick={() => c.key === 'date'? (onDateChange('from',''), onDateChange('to','')) : onFieldChange(c.key, c.key === 'caller'? '' : 'all')}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <button onClick={clearAll} className="clear-all">Clear all</button>
          </div>
        )}

        {/* Filters Grid */}
        <div className={`grid-wrap ${mobileOpen? 'open' : ''}`}>
          <div className="left-col">
            <div className="presets">
              {presets.map((preset) => {
                const isActive = preset.id === activePreset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => onPresetChange(preset.id)}
                    className={`preset-btn ${isActive? 'active' : ''}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="fields-grid-4">
              <Field label="From" icon={<Calendar size={14}/>}>
                <input type="date" value={values.from} onChange={(e) => onDateChange('from', e.target.value)} />
              </Field>
              <Field label="To" icon={<Calendar size={14}/>}>
                <input type="date" value={values.to} onChange={(e) => onDateChange('to', e.target.value)} />
              </Field>
              <Field label="Status" icon={<ChevronDown size={14}/>}>
                <select value={values.status} onChange={(e) => onFieldChange('status', e.target.value)}>
                  <option value="all">All statuses</option>
                  {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Language" icon={<Globe size={14}/>}>
                <select value={values.language} onChange={(e) => onFieldChange('language', e.target.value)}>
                  <option value="all">All languages</option>
                  {languages.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <div className="right-col">
            <Field label="Search" icon={<Search size={14}/>}>
              <input
                type="text"
                value={values.search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search caller, phone, call ID, agent..."
              />
            </Field>

            <div className="fields-grid-2">
              <Field label="Agent" icon={<User size={14}/>}>
                <select value={values.agent} onChange={(e) => onFieldChange('agent', e.target.value)}>
                  <option value="all">All agents</option>
                  {agents.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Caller name" icon={<Phone size={14}/>}>
                <input
                  type="text"
                  value={values.caller}
                  onChange={(e) => onFieldChange('caller', e.target.value)}
                  placeholder="Search caller"
                />
              </Field>
            </div>

            <div className="info-card">
              <p className="info-title">Search behavior</p>
              <p>Search matches caller name, phone numbers, call ID, or agent. Combine with filters to narrow by status, language, and date range.</p>
            </div>
          </div>
        </div>

        {isLoading && <div className="skeleton" />}
      </section>

      <style jsx>{`
       .filter-section {
          position: relative;
          overflow: hidden;
          border-radius: 32px;
          border: 1px solid #FED7AA;
          background: linear-gradient(180deg, #FFF7ED 0%, #ffffff 22%);
          padding: 20px 24px;
          box-shadow: 0 4px 24px rgba(249, 115, 22, 0.08);
          font-family: system-ui, -apple-system, sans-serif;
          animation: fadeUp 0.45s ease both;
        }
       .filter-section::before {
          content: '';
          position: absolute;
          top: -60px;
          right: -60px;
          width: 200px;
          height: 200px;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(249,115,22,0.10), transparent 70%);
          pointer-events: none;
        }
       .header { display: flex; flex-direction: column; gap: 16px; position: relative; }
        @media (min-width: 1024px) {.header { flex-direction: row; align-items: center; justify-content: space-between; } }
       .header-top { display: flex; align-items: center; gap: 8px; }
       .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.3em; color: #94a3b8; margin: 0; }
       .badge { background: #FFEDD5; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #EA580C; animation: pop 0.3s ease; }
        h1 { font-size: 24px; font-weight: 600; color: #0f172a; margin: 4px 0; }
       .subtitle { font-size: 14px; line-height: 1.6; color: #475569; max-width: 700px; margin: 0; }
       .header-actions { display: flex; flex-wrap: wrap; gap: 8px; }
       .btn-primary,.btn-secondary { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; border: 1px solid #FED7AA; background: #fff; color: #334155; cursor: pointer; transition: all .25s ease; }
       .btn-primary { background: linear-gradient(135deg, #F97316, #EA580C); color: #fff; border: none; box-shadow: 0 8px 20px -8px rgba(234,88,12,0.6); }
       .btn-primary:hover { background: linear-gradient(135deg, #FB923C, #F97316); transform: translateY(-1px) scale(1.02); box-shadow: 0 12px 24px -8px rgba(234,88,12,0.7); }
       .btn-primary:active { transform: scale(0.96); }
       .btn-secondary:hover { background: #FFF7ED; border-color: #F97316; transform: translateY(-1px); }
       .refresh-icon { transition: transform 0.5s ease; }
       .btn-primary:hover .refresh-icon { transform: rotate(180deg); }
       .chevron { transition: transform 0.25s ease; }
       .badge-dot { background: #F97316; color: #fff; border-radius: 999px; padding: 2px 6px; font-size: 10px; }
       .mobile-only { display: inline-flex; }
        @media (min-width: 1024px) {.mobile-only { display: none; } }
       .relative { position: relative; }
       .dropdown { position: absolute; right: 0; top: 100%; margin-top: 8px; width: 176px; border-radius: 16px; border: 1px solid #FED7AA; background: #fff; padding: 4px; box-shadow: 0 10px 30px rgba(249,115,22,0.15); z-index: 20; animation: fadeUp 0.18s ease both; }
       .dropdown button { width: 100%; text-align: left; padding: 8px 12px; border-radius: 12px; border: none; background: none; font-size: 14px; cursor: pointer; transition: background .15s ease; }
       .dropdown button:hover { background: #FFF7ED; color: #EA580C; }
       .chips-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; }
       .chip { display: inline-flex; align-items: center; gap: 4px; background: #FFF7ED; color: #EA580C; border: 1px solid #FED7AA; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 500; animation: fadeIn 0.3s ease both; }
       .chip button { background: none; border: none; cursor: pointer; padding: 0; display: flex; }
       .clear-all { background: none; border: none; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; transition: color .15s ease; }
       .clear-all:hover { color: #EA580C; }
       .grid-wrap { margin-top: 20px; display: none; gap: 24px; }
       .grid-wrap.open { display: grid; animation: fadeUp 0.25s ease both; }
        @media (min-width: 1024px) {.grid-wrap { display: grid; grid-template-columns: 1.6fr 1fr; } }
       .left-col,.right-col { display: flex; flex-direction: column; gap: 16px; }
       .presets { display: flex; flex-wrap: wrap; gap: 8px; }
       .preset-btn { border-radius: 999px; border: 1px solid #FED7AA; padding: 8px 16px; font-size: 14px; font-weight: 600; background: #fff; color: #475569; cursor: pointer; transition: all .2s ease; }
       .preset-btn:hover { background: #FFF7ED; border-color: #F97316; transform: translateY(-1px); }
       .preset-btn.active { border-color: #F97316; background: #FFEDD5; color: #EA580C; box-shadow: 0 2px 8px rgba(249,115,22,0.25); }
       .fields-grid-4 { display: grid; gap: 12px; }
        @media (min-width: 640px) {.fields-grid-4 { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1280px) {.fields-grid-4 { grid-template-columns: repeat(4, 1fr); } }
       .fields-grid-2 { display: grid; gap: 12px; }
        @media (min-width: 640px) {.fields-grid-2 { grid-template-columns: repeat(2, 1fr); } }
       .field { display: flex; flex-direction: column; }
       .field-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing:.05em; color: #64748b; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
       .field input,.field select { width: 100%; border-radius: 12px; border: 1px solid #FED7AA; background: #fff; padding: 10px 12px; font-size: 14px; color: #0f172a; outline: none; transition: all .2s ease; }
       .field input:hover,.field select:hover { border-color: #F97316; }
       .field input:focus,.field select:focus { border-color: #F97316; box-shadow: 0 0 0 3px rgba(249,115,22,0.18); }
       .info-card { border-radius: 24px; background: linear-gradient(135deg, #FFF7ED, #FFEDD5); padding: 16px; font-size: 14px; color: #7c2d12; border: 1px solid #FED7AA; }
       .info-title { font-weight: 600; color: #9a3412; margin: 0 0 8px 0; }
       .skeleton { margin-top: 24px; height: 64px; border-radius: 16px; background: #FFF7ED; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity:.5 } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes pop { 0% { transform: scale(0.85); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
      `}</style>
    </>
  );
}

function Field({ label, icon, children }) {
  return (
    <div className="field">
      <label className="field-label">{icon} {label}</label>
      {children}
    </div>
  );
}