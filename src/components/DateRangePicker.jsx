import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import MiniCalendar from './MiniCalendar.jsx';

// =============================================================================
// DateRangePicker — shared filter for /dashboard/{reports,recordings,calls}.
// Two date inputs (From / To) + a row of quick-range chips:
//   Today · Yesterday · This month · Last month · Last 7 days · All time
//
// The parent owns the `from` and `to` strings (YYYY-MM-DD) so persistence /
// URL sync / filtering stays in the page. This is a pure controlled
// component — emits new (from, to) values via onChange({from, to}).
// =============================================================================

// Format a Date as YYYY-MM-DD in the user's local TZ (NOT UTC, otherwise
// "today" rolls over at midnight UTC instead of midnight India time).
const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Display text for the date button — "23 Jul '26", matching the short-date
// format already used elsewhere in the app (e.g. Overview's plan renewal date).
const fmtDisplay = (s) => {
  if (!s) return 'Select date';
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return 'Select date';
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? 'Select date' : dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' });
};

// Each preset returns { from, to } strings. Computed at click time so
// presets stay correct across midnight without a re-mount.
const PRESETS = [
  {
    id: 'today',
    label: 'Today',
    range: () => {
      const t = startOfDay(new Date());
      return { from: ymd(t), to: ymd(t) };
    },
  },
  {
    id: 'yesterday',
    label: 'Yesterday',
    range: () => {
      const t = startOfDay(new Date());
      t.setDate(t.getDate() - 1);
      return { from: ymd(t), to: ymd(t) };
    },
  },
  {
    id: 'last7',
    label: 'Last 7 days',
    range: () => {
      const to = startOfDay(new Date());
      const from = new Date(to);
      from.setDate(to.getDate() - 6);
      return { from: ymd(from), to: ymd(to) };
    },
  },
  {
    id: 'thismonth',
    label: 'This month',
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: ymd(from), to: ymd(now) };
    },
  },
  {
    id: 'lastmonth',
    label: 'Last month',
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to   = new Date(now.getFullYear(), now.getMonth(), 0); // 0 = last day of prev month
      return { from: ymd(from), to: ymd(to) };
    },
  },
  {
    id: 'alltime',
    label: 'All time',
    range: () => ({ from: '', to: '' }),
  },
];

// Active-chip accent — defaults to the brand's lime everywhere this component
// is already used (Recordings, Calls); Reports passes accent="green" to match
// its brand-green (#3a5a0c) accent instead.
const ACCENTS = {
  lime: { active: 'bg-lime-100 border-lime-300 text-lime-800', hover: 'hover:bg-lime-100 hover:border-lime-300 hover:text-lime-700' },
  green: {
    active: 'bg-[#3a5a0c] border-[#3a5a0c] text-white',
    hover: 'hover:border-[rgba(77,124,15,0.35)] hover:text-[#3a5a0c]',
  },
};

export default function DateRangePicker({ from, to, onChange, className = '', accent = 'lime' }) {
  const accentClasses = ACCENTS[accent] || ACCENTS.lime;
  // Highlight whichever preset's range matches the current (from, to). This
  // lets the picker show "Today" as active when first mounted, and stay in
  // sync when the user manually types matching dates.
  const activePresetId = useMemo(() => {
    for (const p of PRESETS) {
      const r = p.range();
      if (r.from === (from || '') && r.to === (to || '')) return p.id;
    }
    return null;
  }, [from, to]);

  const apply = (preset) => {
    const r = preset.range();
    onChange?.({ from: r.from, to: r.to });
  };

  // Which field's calendar is open — 'from' | 'to' | null. Opens as a
  // centered modal (backdrop + card), same pattern as the Tickets page's
  // detail modal — click the backdrop or the × to close.
  const [openField, setOpenField] = useState(null);
  const closeModal = () => setOpenField(null);
  const handleSelect = (d) => {
    if (openField === 'from') onChange?.({ from: d, to: to || '' });
    else if (openField === 'to') onChange?.({ from: from || '', to: d });
    closeModal();
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = activePresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => apply(p)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                active
                  ? accentClasses.active
                  : `bg-white border-slate-200 text-slate-600 ${accentClasses.hover}`
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <div>
          <label className="field-label">From date</label>
          <button type="button" className="input text-sm py-1.5 text-left" onClick={() => setOpenField('from')}>
            {fmtDisplay(from)}
          </button>
        </div>
        <div>
          <label className="field-label">To date</label>
          <button type="button" className="input text-sm py-1.5 text-left" onClick={() => setOpenField('to')}>
            {fmtDisplay(to)}
          </button>
        </div>
      </div>

      {openField && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 animate-backdrop-in"
          onClick={closeModal}
        >
          <div className="relative animate-modal-in animate-modal-border-shadow" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={closeModal}
              className="absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full bg-white border shadow flex items-center justify-center text-mute hover:text-slate-900 transition duration-200 ease-out hover:scale-110 active:scale-95"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <MiniCalendar
              value={openField === 'from' ? from : to}
              min={openField === 'to' ? (from || undefined) : undefined}
              max={openField === 'from' ? (to || undefined) : undefined}
              onSelect={handleSelect}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Helper for parents — compute today's YYYY-MM-DD pair. Used to seed the
// default state so the page lands showing "today" without a re-render.
export const todayRange = () => {
  const t = startOfDay(new Date());
  return { from: ymd(t), to: ymd(t) };
};
