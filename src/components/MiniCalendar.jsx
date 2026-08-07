import { useState } from 'react';

// =============================================================================
// MiniCalendar — a single-month calendar popover in the app's own brand style
// (green accent, rounded cells), used by DateRangePicker to replace the
// native OS date-input calendar. The native one renders as browser chrome
// outside the page's control (different look per OS/browser, blue accent,
// can't be restyled) — this one is just page content, so it always matches
// the rest of the app and opens inline instead of as a native popup.
// =============================================================================

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseYmd = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
};

export default function MiniCalendar({ value, min, max, onSelect }) {
  const selectedDate = parseYmd(value);
  const minDate = parseYmd(min);
  const maxDate = parseYmd(max);

  const [month, setMonth] = useState(() => {
    const base = selectedDate || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDate = new Date(first);
  startDate.setDate(startDate.getDate() - first.getDay());

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return d;
  });

  const todayKey = ymd(new Date());
  const selectedKey = value || '';
  const inMonth = (d) => d.getMonth() === month.getMonth();
  const isDisabled = (d) => (minDate && d < minDate) || (maxDate && d > maxDate);

  const goToday = () => {
    const n = new Date();
    setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
    if (!isDisabled(n)) onSelect(ymd(n));
  };

  return (
    <div className="rounded-xl border bg-white shadow-xl p-3 w-72" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition"
          aria-label="Previous month"
        >←</button>
        <div className="text-sm font-semibold text-slate-900">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={goToday} className="btn-teal text-xs px-3 py-1">Today</button>
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition"
            aria-label="Next month"
          >→</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
        {WEEKDAYS.map((w) => <div key={w} className="text-center py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = ymd(d);
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const muted = !inMonth(d);
          const disabled = isDisabled(d);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(key)}
              className={[
                'aspect-square rounded-lg text-xs font-semibold flex items-center justify-center transition',
                disabled ? 'text-slate-200 cursor-not-allowed' : muted ? 'text-slate-300 hover:bg-slate-50' : 'text-slate-700 hover:bg-slate-50',
                isSelected ? 'border-2 border-lime-600 text-lime-700' : (isToday ? 'border border-lime-400' : 'border border-transparent'),
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
