import { useEffect, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// Same Stripe loader pattern used by Billing.jsx — module-level cache
// means a single <script> injection per session even if both pages mount.
let _rzpLoad;
function loadStripe() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (_rzpLoad) return _rzpLoad;
  _rzpLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.stripe.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(window.Stripe);
    s.onerror = () => reject(new Error('Could not load Stripe'));
    document.head.appendChild(s);
  });
  return _rzpLoad;
}

// =============================================================================
// AddMinutesModal — floating window that opens when a customer clicks
// "+ Add minutes" on a per-DID card. Renders the three top-up packs and
// drives the Stripe modal directly so customers never leave the page.
//
// Props:
//   number       — the DID this top-up is tagged against
//   packs        — same shape /api/wallet returns (id, amount, mins, rate)
//   currentUser  — needed for the Stripe prefill
//   onClose      — close the modal
//   onSuccess    — called with the credited payload so the parent can reload
// =============================================================================
export default function AddMinutesModal({ number, packs, currentUser, onClose, onSuccess }) {
  const [busy, setBusy]   = useState(null); // pack id currently being charged
  const [err, setErr]     = useState('');
  const [msg, setMsg]     = useState('');

  // Lock body scroll while open + close on Escape.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const topUp = async (pack) => {
    setBusy(pack.id); setErr(''); setMsg('');
    try {
      
      const order = await api('/api/stripe/checkout-session/topup', {
        method: 'POST', body: { pack: pack.id },
      });
      if (order.url) { window.location.href = order.url; return; }
    } catch (e) {
      setErr(e.message);
      setBusy(null);
    }
  };

  // Per-DID renewal warning — surfaces the SAME date the customer just saw
  // on the per-DID card they clicked from, so a recharge intent meets a
  // clear "your number's plan renews on X" line of context.
  let expiryBanner = null;
  if (number?.nextRentalAt) {
    const exp = new Date(number.nextRentalAt);
    const days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
    const fmt = exp.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const tone =
        days < 0  ? 'border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300'
      : days <= 7 ? 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300'
      :             'border-lime-500/30 bg-lime-500/5 text-lime-800 dark:text-lime-300';
    expiryBanner = (
      <div className={`rounded-lg border ${tone} px-3 py-2 text-xs flex items-start gap-2 mb-3`}>
        <span className="shrink-0">📅</span>
        <div>
          This number's plan{' '}
          {days < 0
            ? <>expired on <strong>{fmt}</strong>. Renew first or the new minutes won't be usable.</>
            : <>renews on <strong>{fmt}</strong> ({days} day{days === 1 ? '' : 's'} left). Top-up minutes carry forward across the renewal.</>
          }
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* === HEADER ===================================================== */}
        <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">➕ Add wallet funds</div>
            <div className="mt-1 font-mono text-sm text-slate-900 dark:text-slate-100">
              {number?.value || '—'}
              {number?.isPrimary && <span className="ml-2 pill bg-lime-100 text-lime-700 text-xs">Primary</span>}
              {number?.label && <span className="ml-2 text-xs text-mute">· {number.label}</span>}
            </div>
            <div className="mt-0.5 text-xs text-mute">
              Funds go into the shared wallet — used as backup when a number's plan minutes run out, at that number's plan rate.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-lg"
          >
            ✕
          </button>
        </div>

        {/* === BODY ======================================================= */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {expiryBanner}

          {msg && (
            <div className="mb-3 rounded-lg border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300 px-3 py-2 text-sm">
              {msg}
            </div>
          )}
          {err && (
            <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
              ⚠ {err}
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-4">
            {(packs || []).map((p) => {
              const isFeatured = p.id === 'growth';
              const isBusy = busy === p.id;
              return (
                <div
                  key={p.id}
                  className={`form-card text-center transition ${
                    isFeatured ? 'border-lime-400 ring-2 ring-lime-200 dark:ring-lime-900/40' : ''
                  }`}
                >
                  <div className="text-xs uppercase font-semibold tracking-wider text-mute">
                    Wallet pack
                  </div>
                  <div className="mt-1 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{inr(p.amount)}</div>
                  <div className="text-[11px] text-mute mt-1">credit to shared wallet</div>
                  <button
                    className={isFeatured ? 'btn-teal w-full mt-4' : 'btn-ghost w-full mt-4'}
                    onClick={() => topUp(p)}
                    disabled={busy !== null}
                  >
                    {isBusy ? 'Opening Stripe…' : `Add ${inr(p.amount)}`}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-[11px] text-mute text-center">
            Secure payment via Stripe · cards / UPI / netbanking accepted.
          </div>
        </div>
      </div>
    </div>
  );
}
