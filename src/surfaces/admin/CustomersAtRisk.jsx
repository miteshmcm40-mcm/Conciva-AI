import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_CATALOG = [
  { id: 'starter', label: 'Starter' },
  { id: 'growth', label: 'Growth' },
  { id: 'scale', label: 'Scale' },
];

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const toDateInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addBillingCycle = (iso, cycle = 'monthly') => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const next = new Date(d);
  if (cycle === 'yearly') next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString();
};

const daysUntil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / DAY_MS);
};

const normalizePlanId = (plan) => String(plan?.id || plan?.label || '').trim().toLowerCase();
const planLabelFor = (plan) => {
  const id = normalizePlanId(plan);
  return PLAN_CATALOG.find((p) => p.id === id)?.label || plan?.label || '—';
};

const didsFor = (u) => {
  if (Array.isArray(u.numbers) && u.numbers.length) return u.numbers;
  if (u.number) {
    return [{
      id: `legacy-${u.id}`,
      value: u.number,
      isPrimary: true,
      status: 'ready',
      activatedAt: u.planActivated || u.createdAt || null,
      nextRentalAt: u.planExpires || addBillingCycle(u.planActivated || u.createdAt || null, 'monthly'),
      rentStatus: (u.planExpires && daysUntil(u.planExpires) < 0) ? 'expired' : 'active',
      autoRechargeEnabled: false,
      planCycle: 'monthly',
      plan: u.plan || null,
    }];
  }
  return [];
};

const buildRows = (users) => {
  return (users || []).flatMap((u) => {
    const dids = didsFor(u);
    const baseCustomer = u.company || u.name || u.email || 'Unknown customer';

    if (dids.length === 0) {
      const endDate = u.planExpires || null;
      const remaining = daysUntil(endDate);
      return [{
        key: `inactive-${u.id}`,
        customer: baseCustomer,
        email: u.email,
        userId: u.id,
        planId: normalizePlanId(u.plan),
        planLabel: planLabelFor(u.plan) || 'No active plan',
        startedDate: u.planActivated || u.createdAt || null,
        endDate,
        autoRenewalEnabled: false,
        numberValue: null,
        daysRemaining: remaining,
        status: 'inactive',
        rowTone: 'bg-slate-50/80',
      }];
    }

    return dids.map((d) => {
      const startedDate = d.activatedAt || d.createdAt || u.planActivated || u.createdAt || null;
      const endDate = d.nextRentalAt || u.planExpires || addBillingCycle(startedDate, d.planCycle || 'monthly');
      const remaining = daysUntil(endDate);
      const expired = d.rentStatus === 'expired' || (remaining != null && remaining < 0);
      const inactive = !expired && ['failed', 'unprovisioned'].includes(String(d.status || '').toLowerCase());
      const expiringSoon = !expired && !inactive && remaining != null && remaining <= 7;
      const status = expired ? 'expired' : inactive ? 'inactive' : expiringSoon ? 'expiring_soon' : 'live';
      const rowTone = expired
        ? 'bg-red-50/80'
        : expiringSoon
          ? 'bg-amber-50/80'
          : '';

      return {
        key: `${u.id}-${d.id}`,
        customer: baseCustomer,
        email: u.email,
        userId: u.id,
        planId: normalizePlanId(d.plan || u.plan),
        planLabel: planLabelFor(d.plan || u.plan),
        startedDate,
        endDate,
        autoRenewalEnabled: !!d.autoRechargeEnabled,
        numberValue: d.value || null,
        daysRemaining: remaining,
        status,
        rowTone,
      };
    });
  });
};

const isRiskRow = (row) => {
  const expiringSoon = row.daysRemaining != null && row.daysRemaining >= 0 && row.daysRemaining <= 7;
  return !row.autoRenewalEnabled || expiringSoon || row.status === 'expired' || row.status === 'inactive';
};

const statusMeta = (status) => {
  if (status === 'live') return { label: 'Live', cls: 'bg-lime-100 text-lime-700' };
  if (status === 'expiring_soon') return { label: 'Expiring Soon', cls: 'bg-amber-100 text-amber-700' };
  if (status === 'expired') return { label: 'Expired', cls: 'bg-red-100 text-red-700' };
  return { label: 'Inactive', cls: 'bg-slate-200 text-slate-700' };
};

const renewalMeta = (enabled) => enabled
  ? { label: 'Enabled', cls: 'bg-emerald-100 text-emerald-700' }
  : { label: 'Disabled', cls: 'bg-red-100 text-red-700' };

const daysMeta = (daysRemaining, status) => {
  if (status === 'expired' || (daysRemaining != null && daysRemaining < 0)) {
    return { label: 'Expired', cls: 'text-red-600' };
  }
  if (daysRemaining == null) return { label: '—', cls: 'text-slate-500' };
  if (daysRemaining > 15) return { label: `${daysRemaining} Days Left`, cls: 'text-lime-600' };
  if (daysRemaining >= 7) return { label: `${daysRemaining} Days Left`, cls: 'text-amber-600' };
  if (daysRemaining === 1) return { label: '1 Day Left', cls: 'text-red-600' };
  return { label: `${Math.max(0, daysRemaining)} Days Left`, cls: 'text-red-600' };
};

const uniqueCount = (rows, predicate) => {
  return new Set(rows.filter(predicate).map((row) => row.userId)).size;
};

export default function CustomersAtRisk() {
  const { currentUser } = useApp();
  const [users, setUsers] = useState(() => readCache('admin.customersAtRisk.users', currentUser?.id) ?? null);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState({
    customer: '',
    userId: '',
    plan: 'all',
    status: 'all',
    autoRenewal: 'all',
    expiryDate: '',
  });

  const load = async () => {
    setErr('');
    try {
      const data = await api('/api/admin/users');
      const next = data.users.filter((u) => u.role === 'customer');
      setUsers(next);
      writeCache('admin.customersAtRisk.users', currentUser?.id, next);
    } catch (e) {
      setErr(e.message);
      setUsers([]);
    }
  };

  useEffect(() => { load(); }, []);

  const riskRows = useMemo(() => buildRows(users).filter(isRiskRow), [users]);
  const planOptions = useMemo(() => PLAN_CATALOG, []);

  const filteredRows = useMemo(() => {
    return riskRows.filter((row) => {
      const customerNeedle = filters.customer.trim().toLowerCase();
      const userIdNeedle = filters.userId.trim().toLowerCase();
      if (customerNeedle) {
        const haystack = `${row.customer} ${row.email || ''}`.toLowerCase();
        if (!haystack.includes(customerNeedle)) return false;
      }
      if (userIdNeedle && !String(row.userId).toLowerCase().includes(userIdNeedle)) return false;
      if (filters.plan !== 'all' && row.planId !== filters.plan) return false;
      if (filters.status !== 'all' && row.status !== filters.status) return false;
      if (filters.autoRenewal === 'enabled' && !row.autoRenewalEnabled) return false;
      if (filters.autoRenewal === 'disabled' && row.autoRenewalEnabled) return false;
      if (filters.expiryDate && toDateInput(row.endDate) !== filters.expiryDate) return false;
      return true;
    });
  }, [filters, riskRows]);

  const summary = useMemo(() => ({
    total: uniqueCount(riskRows, () => true),
    autoRenewalDisabled: uniqueCount(riskRows, (row) => !row.autoRenewalEnabled),
    expiringSoon: uniqueCount(riskRows, (row) => row.daysRemaining != null && row.daysRemaining >= 0 && row.daysRemaining <= 7),
    expired: uniqueCount(riskRows, (row) => row.status === 'expired'),
  }), [riskRows]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          Monitor customers whose subscriptions need attention before they lapse or go dark.
        </p>
        <button className="btn-teal text-sm whitespace-nowrap" onClick={load}>↻ Refresh</button>
      </div>

      {err && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}

      <div className="mt-6 grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard label="Total Subscription Alerts" value={summary.total} tone="text-red-600" />
        <SummaryCard label="Auto Renewal Disabled" value={summary.autoRenewalDisabled} tone="text-red-600" />
        <SummaryCard label="Expiring Within 7 Days" value={summary.expiringSoon} tone="text-amber-600" />
        <SummaryCard label="Expired Customers" value={summary.expired} tone="text-red-600" />
      </div>

      <div className="mt-6 form-card">
        <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-3">
          <FilterInput
            label="Search Customer"
            value={filters.customer}
            onChange={(value) => setFilters((cur) => ({ ...cur, customer: value }))}
            placeholder="Company or email"
          />
          <FilterInput
            label="Search User ID"
            value={filters.userId}
            onChange={(value) => setFilters((cur) => ({ ...cur, userId: value }))}
            placeholder="User ID"
          />
          <FilterSelect
            label="Plan"
            value={filters.plan}
            onChange={(value) => setFilters((cur) => ({ ...cur, plan: value }))}
            options={[{ value: 'all', label: 'All Plans' }, ...planOptions.map((plan) => ({ value: plan.id, label: plan.label }))]}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(value) => setFilters((cur) => ({ ...cur, status: value }))}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'live', label: 'Live' },
              { value: 'expiring_soon', label: 'Expiring Soon' },
              { value: 'expired', label: 'Expired' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
          <FilterSelect
            label="Auto Renewal"
            value={filters.autoRenewal}
            onChange={(value) => setFilters((cur) => ({ ...cur, autoRenewal: value }))}
            options={[
              { value: 'all', label: 'All' },
              { value: 'enabled', label: 'Enabled' },
              { value: 'disabled', label: 'Disabled' },
            ]}
          />
          <div>
            <label className="field-label">Expiry Date</label>
            <input
              type="date"
              className="input text-sm"
              value={filters.expiryDate}
              onChange={(e) => setFilters((cur) => ({ ...cur, expiryDate: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>User ID</th>
              <th>Plan</th>
              <th>Started Date</th>
              <th>End Date</th>
              <th>Auto Renewal</th>
              <th>Status</th>
              <th>Days Remaining</th>
            </tr>
          </thead>
          <tbody>
            {users === null && <tr><td colSpan={8} className="text-center text-mute py-6">Loading…</td></tr>}
            {users !== null && filteredRows.length === 0 && (
              <tr><td colSpan={8} className="text-center text-mute py-8">No customers match the current risk filters.</td></tr>
            )}
            {filteredRows.map((row) => {
              const status = statusMeta(row.status);
              const renewal = renewalMeta(row.autoRenewalEnabled);
              const remaining = daysMeta(row.daysRemaining, row.status);
              return (
                <tr key={row.key} className={row.rowTone}>
                  <td>
                    <div className="font-medium text-slate-900">{row.customer}</div>
                    <div className="text-xs text-mute">{row.email}</div>
                    {row.numberValue && <div className="text-[11px] text-mute font-mono mt-1">{row.numberValue}</div>}
                  </td>
                  <td className="font-mono text-xs text-mute">{row.userId}</td>
                  <td>
                    <div className="font-semibold text-slate-900">{row.planLabel}</div>
                  </td>
                  <td className="text-sm text-slate-700">{fmtDate(row.startedDate)}</td>
                  <td className="text-sm text-slate-700">{fmtDate(row.endDate)}</td>
                  <td>
                    <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${renewal.cls}`}>
                      {renewal.label}
                    </span>
                  </td>
                  <td>
                    <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${status.cls}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className={`text-sm font-semibold ${remaining.cls}`}>{remaining.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className="form-card">
      <div className="text-xs text-mute uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="input text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <label className="field-label">{label}</label>
      <button
        type="button"
        className={`w-full min-h-[45px] rounded-[10px] border bg-white px-[14px] pr-11 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition text-left ${
          open
            ? 'border-[var(--primary)] text-[var(--ink)] ring-4 ring-[rgba(77,124,15,0.14)]'
            : 'border-[var(--line)] text-[var(--ink)] hover:border-slate-300'
        }`}
        onClick={() => setOpen((cur) => !cur)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="block truncate">{selected?.label}</span>
      </button>
      <span className={`absolute right-2.5 top-[38px] -translate-y-1/2 pointer-events-none flex h-6 w-6 items-center justify-center rounded-md ring-1 transition ${
        open
          ? 'bg-lime-100 text-lime-700 ring-lime-200'
          : 'bg-lime-50 text-lime-700 ring-lime-100'
      }`}>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </span>
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_18px_48px_rgba(15,23,42,0.14)]"
          role="listbox"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${
                option.value === value
                  ? 'bg-lime-50 text-lime-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              aria-selected={option.value === value}
            >
              <span className="truncate">{option.label}</span>
              <span className={`ml-3 flex h-5 w-5 items-center justify-center rounded-full ${
                option.value === value ? 'bg-lime-100 text-lime-700' : 'text-transparent'
              }`}>
                <Check className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
