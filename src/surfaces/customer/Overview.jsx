// import { useEffect, useState } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { AlarmClock, Zap, Phone, AlertTriangle, LayoutDashboard, RefreshCw, TrendingUp } from 'lucide-react';
// import { useApp } from '../../AppContext.jsx';
// import { api } from '../../api.js';
// import { readCache, writeCache } from '../../utils/swrCache.js';

// const fmtDuration = (s) => {
//   if (!s) return '0s';
//   const m = Math.floor(s / 60);
//   const sec = s % 60;
//   return m ? `${m}m ${sec}s` : `${sec}s`;
// };

// const fmtDate = (iso) => {
//   if (!iso) return '—';
//   try {
//     return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' });
//   } catch {
//     return '—';
//   }
// };

// export default function Overview({ rechargeOn }) {
//   const { currentUser } = useApp();
//   const navigate = useNavigate();
//   const [stats, setStats] = useState(() => readCache('overview.stats', currentUser?.id));
//   const [statsErr, setStatsErr] = useState('');
//   const [statsLoading, setStatsLoading] = useState(true);

//   const [wallet, setWallet] = useState(() => readCache('overview.wallet', currentUser?.id));
//   const [topupBusy, setTopupBusy] = useState(false);
//   const [topupMsg, setTopupMsg] = useState('');
//   const [numbers, setNumbers] = useState(() => readCache('overview.numbers', currentUser?.id) ?? []);
//   const [numbersLoading, setNumbersLoading] = useState(true);

//   // Call analytics card — call-statistics / sentiment / call-volume are all
//   // auto-scoped to this customer's own agent server-side (PER_AGENT_TOOLS in
//   // server/index.js), so they're safe to call directly, unlike /api/mcp/overview
//   // which is tenant-wide and stays admin-only.
//   const [callStats, setCallStats] = useState(() => readCache('overview.callStats', currentUser?.id));
//   const [sentiment, setSentiment] = useState(() => readCache('overview.sentiment', currentUser?.id));
//   const [volume, setVolume] = useState(() => readCache('overview.volume', currentUser?.id));

//   const refreshWallet = async () => {
//     try {
//       const w = await api('/api/wallet');
//       setWallet(w.wallet);
//       writeCache('overview.wallet', currentUser?.id, w.wallet);
//     } catch { }
//   };

//   useEffect(() => {
//     let cancelled = false;

//     // Each request fires immediately (nothing here is awaited before the
//     // next starts) and updates its own state the moment it resolves — so
//     // e.g. the numbers table paints as soon as /api/numbers is back instead
//     // of waiting on /api/twilio/stats, which is the slowest of the six.
//     api('/api/twilio/stats')
//       .then((data) => {
//         if (cancelled) return;
//         setStats(data);
//         writeCache('overview.stats', currentUser?.id, data);
//       })
//       .catch((e) => { if (!cancelled) setStatsErr(e.message); })
//       .finally(() => { if (!cancelled) setStatsLoading(false); });

//     api('/api/wallet')
//       .then((w) => {
//         if (cancelled) return;
//         setWallet(w.wallet);
//         writeCache('overview.wallet', currentUser?.id, w.wallet);
//       })
//       .catch(() => { });

//     api('/api/numbers')
//       .then((r) => {
//         if (cancelled) return;
//         const next = r.numbers || [];
//         setNumbers(next);
//         writeCache('overview.numbers', currentUser?.id, next);
//       })
//       .catch(() => { })
//       .finally(() => { if (!cancelled) setNumbersLoading(false); });

//     // These three were previously grouped in one Promise.all, so the volume
//     // chart couldn't paint until call-statistics AND sentiment also
//     // finished — even when call-volume itself came back fast. Now each
//     // fires independently and updates its own state the instant it
//     // resolves, same as the four requests above.
//     api('/api/mcp/call-statistics?days=30')
//       .then((cs) => {
//         if (cancelled) return;
//         const csData = cs?.data || null;
//         setCallStats(csData);
//         writeCache('overview.callStats', currentUser?.id, csData);
//       })
//       .catch(() => { });

//     api('/api/mcp/sentiment?days=30')
//       .then((sent) => {
//         if (cancelled) return;
//         const sentData = sent?.data || null;
//         setSentiment(sentData);
//         writeCache('overview.sentiment', currentUser?.id, sentData);
//       })
//       .catch(() => { });

//     api('/api/mcp/call-volume?days=14')
//       .then((vol) => {
//         if (cancelled) return;
//         const volData = vol?.data || null;
//         setVolume(volData);
//         writeCache('overview.volume', currentUser?.id, volData);
//       })
//       .catch(() => { });

//     return () => { cancelled = true; };
//   }, [currentUser?.role]);

//   const quickTopUp = async () => {
//     setTopupBusy(true);
//     setTopupMsg('');
//     try {
//       const r = await api('/api/wallet/topup', { method: 'POST', body: { pack: 'starter' } });
//       setTopupMsg(`✓ +${r.charged.minutes} min added · charged $${Number(r.charged.amountUsd || 0).toLocaleString('en-US')} to ${r.charged.descriptor}`);
//       await refreshWallet();
//     } catch (e) {
//       setTopupMsg(`✗ ${e.message}`);
//     } finally {
//       setTopupBusy(false);
//     }
//   };

//   if (!currentUser) return null;

//   const displayNumbers = numbers;
//   const displayStats = stats;
//   const displayCallStats = callStats;
//   const displaySentiment = sentiment;
//   const displayVolume = volume;

//   const planMin = currentUser.plan?.min || 0;
//   const minUsedAllTime = displayStats?.minutesUsedAllTime ?? Number(currentUser.minutesUsed) ?? 0;
//   const minUsedMonth = displayStats?.minutesUsedThisMonth ?? 0;
//   const planLeft = Math.max(0, planMin - minUsedAllTime);
//   const walletMin = wallet?.walletMinutes ?? currentUser.walletMinutes ?? 0;
//   const minLeft = Math.max(0, planLeft + walletMin);
//   const minTotal = planMin + walletMin;
//   const lowThreshold = wallet?.lowBalanceThreshold ?? currentUser.lowBalanceThreshold ?? 20;
//   const isLow = displayNumbers.length > 0 && minLeft <= lowThreshold;
//   const autoTopupOn = wallet?.autoTopupEnabled ?? currentUser.autoTopupEnabled;

//   // Proactive "renews soon" nudge — only meaningful for a single-number
//   // account (a multi-number account has staggered renewal dates, so one
//   // countdown wouldn't represent all of them). Shown in demo mode too since
//   // it's purely navigational (no charge risk), unlike the low-minutes banner.
//   const nextRenewal = displayNumbers[0]?.nextRentalAt ? new Date(displayNumbers[0].nextRentalAt) : null;
//   const daysUntilRenewal = nextRenewal && !isNaN(nextRenewal.getTime())
//     ? Math.ceil((nextRenewal.getTime() - Date.now()) / 86400000)
//     : null;
//   const renewalSoon = displayNumbers.length === 1 && daysUntilRenewal != null && daysUntilRenewal <= 7;

//   // Per-row usage breakdown is only exact when the customer has a single DID
//   // — /api/twilio/stats aggregates across every number, so with more than
//   // one it can't be attributed to a specific row without new backend work.
//   const singleNumber = displayNumbers.length === 1;

//   const testNumber = displayNumbers[0]?.value || currentUser.number?.value;

//   // This component renders under both /dashboard (Customer) and /admin
//   // (Admin/Superadmin, since they share the same Overview page) — links must
//   // resolve against whichever shell is actually mounted.
//   const isAdminTier =
//     currentUser.userType === 'superadmin'
//     || currentUser.userType === 'admin'
//     || currentUser.role === 'admin';
//   const basePath = isAdminTier ? '/admin' : '/dashboard';

//   const activityFeed = [
//     { title: 'Inbound call answered', meta: 'Demo number • 2m 14s', time: '4 min ago', state: 'Completed' },
//     { title: 'Plan top-up processed', meta: '83 minutes added to your wallet', time: '1 hr ago', state: 'Success' },
//     { title: 'Knowledge base refreshed', meta: 'Latest FAQ updates synced', time: 'Today', state: 'Updated' },
//   ];

//   const volumeBars = (displayVolume?.daily_breakdown || []).slice(-7);

//   return (
//     <div className="space-y-6">
//       {statsErr && (
//         <div className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs text-orange-700">
//           <AlertTriangle size={12} /> Live stats unavailable: {statsErr}
//         </div>
//       )}

//       <ProvisioningBanner />

//       {isLow && (
//         <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 flex items-start gap-3">
//           <AlarmClock size={20} className="text-orange-600 flex-shrink-0" />
//           <div className="flex-1">
//             <div className="font-semibold text-orange-700">Low minutes — only {minLeft.toFixed(1)} left</div>
//             <p className="text-sm text-slate-600 mt-1">
//               You are at or below your low-balance threshold ({lowThreshold} min). Top up now to keep your agent active.
//             </p>
//             <div className="mt-3 flex flex-wrap gap-2">
//               {!autoTopupOn && (
//                 <button className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5" onClick={quickTopUp} disabled={topupBusy}>
//                   {topupBusy ? 'Charging…' : <><Zap size={14} /> Top up 83 min</>}
//                 </button>
//               )}
//               <Link to={`${basePath}/billing`} className="btn-ghost text-sm">Manage wallet →</Link>
//               {topupMsg && <span className="text-xs text-slate-500 ml-2 self-center">{topupMsg}</span>}
//             </div>
//           </div>
//         </div>
//       )}

//       {renewalSoon && (
//         <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 flex items-start gap-3">
//           <RefreshCw size={20} className="text-orange-600 flex-shrink-0" />
//           <div className="flex-1">
//             <div className="font-semibold text-orange-700">
//               {daysUntilRenewal <= 0 ? 'Plan renewal is due' : `Plan renews in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? '' : 's'}`}
//             </div>
//             <p className="text-sm text-slate-600 mt-1">
//               Your {displayNumbers[0]?.plan?.label || 'current'} plan renews on {fmtDate(nextRenewal)}. Upgrade now to keep your availability steady.
//             </p>
//             <div className="mt-3 flex flex-wrap gap-2">
//               <Link to={`${basePath}/billing?tab=plans`} className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5">
//                 <TrendingUp size={14} /> Upgrade plan
//               </Link>
//               <Link to={`${basePath}/billing`} className="btn-ghost text-sm">Manage plan →</Link>
//             </div>
//           </div>
//         </div>
//       )}

//       <div className="rounded-[28px] border border-black bg-black p-6 shadow-sm">
//         <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
//           <div>
//             <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-400">Account overview</div>
//             <h2 className="mt-2 font-display text-2xl font-semibold text-white">Good morning, {currentUser?.name || 'Demo User'}</h2>
//             <p className="mt-2 max-w-2xl text-sm text-slate-300">
//               Your voice agent is active and your numbers are performing well. This snapshot highlights minute balance, recent activity, and the next best action.
//             </p>
//           </div>
//           <div className="rounded-2xl border border-orange-500/30 bg-white px-4 py-3">
//             <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-600">Primary number</div>
//             <div className="mt-1 font-semibold text-black">{testNumber || currentUser?.number?.value || '—'}</div>
//             <div className="mt-1 text-sm text-slate-600">{currentUser?.plan?.label || 'Demo Plan'}</div>
//           </div>
//         </div>

//         <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
//           <MetricCard label="Minutes left" value={`${minLeft.toFixed(0)} min`} note={`${minTotal.toFixed(0)} available`} />
//           <MetricCard label="Calls today" value={displayStats?.callsToday ?? 0} note="Live activity" />
//           <MetricCard label="Monthly minutes" value={fmtDuration((displayStats?.minutesUsedThisMonth || 0) * 60)} note="This month" />
//           <MetricCard label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '—'} note="Last 30 days" />
//         </div>
//       </div>

//       <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
//         <div className="rounded-[24px] border border-black bg-white p-6 shadow-sm">
//           <div className="flex items-center justify-between gap-3">
//             <div>
//               <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-500">Minutes & plan</div>
//               <h3 className="mt-1 text-lg font-semibold text-black">Your current plan balance</h3>
//             </div>
//             <Link to={`${basePath}/billing`} className="text-sm font-medium text-orange-600 hover:underline">Manage plan</Link>
//           </div>

//           <div className="mt-5 rounded-2xl border border-black bg-black p-4">
//             <div className="flex items-center justify-between text-sm text-slate-300">
//               <span>Included minutes</span>
//               <span className="font-semibold text-white">{planMin.toFixed(0)} min</span>
//             </div>
//             <div className="mt-3 h-2 rounded-full bg-slate-800">
//               <div className="h-2 rounded-full bg-orange-500" style={{ width: `${Math.min(100, (minLeft / Math.max(1, minTotal)) * 100)}%` }} />
//             </div>
//             <div className="mt-3 flex items-center justify-between text-sm text-slate-300">
//               <span>{minLeft.toFixed(0)} minutes remaining</span>
//               <span>{minUsedAllTime.toFixed(0)} used so far</span>
//             </div>
//           </div>

//           <div className="mt-5 grid gap-3 sm:grid-cols-2">
//             <div className="rounded-2xl border border-black bg-black p-4">
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-400">Wallet balance</div>
//               <div className="mt-2 text-xl font-semibold text-white">{walletMin.toFixed(0)} min</div>
//               <div className="mt-1 text-sm text-slate-300">{wallet?.walletUsd ?? currentUser?.walletUsd ?? 0} USD available</div>
//             </div>
//             <div className="rounded-2xl border border-black bg-black p-4">
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-400">Auto top-up</div>
//               <div className="mt-2 text-xl font-semibold text-white">{autoTopupOn ? 'Enabled' : 'Off'}</div>
//               <div className="mt-1 text-sm text-slate-300">Keep service running without interruptions</div>
//             </div>
//           </div>
//         </div>

//         <div className="space-y-6">
//           <div className="rounded-[24px] border border-black bg-white p-6 shadow-sm">
//             <div className="flex items-center justify-between gap-3">
//               <div>
//                 <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-500">Quick actions</div>
//                 <h3 className="mt-1 text-lg font-semibold text-black">Keep the experience moving</h3>
//               </div>
//             </div>
//             <div className="mt-4 grid gap-3">
//               <Link to={`${basePath}/agents`} className="rounded-2xl border border-black bg-black px-4 py-3 text-sm font-medium text-white hover:bg-slate-900">Edit agent</Link>
//               <Link to={`${basePath}/billing`} className="rounded-2xl border border-orange-500 bg-orange-500 px-4 py-3 text-sm font-medium text-white hover:bg-orange-600">Buy more minutes</Link>
//               <Link to={`${basePath}/analytics`} className="rounded-2xl border border-black bg-white px-4 py-3 text-sm font-medium text-black hover:bg-slate-100">View analytics</Link>
//             </div>
//           </div>

//           <div className="rounded-[24px] border border-black bg-white p-6 shadow-sm">
//             <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-500">Recent activity</div>
//             <div className="mt-4 space-y-3">
//               {activityFeed.map((item) => (
//                 <div key={item.title} className="rounded-2xl border border-black bg-black p-3">
//                   <div className="flex items-center justify-between gap-3">
//                     <div className="font-medium text-white">{item.title}</div>
//                     <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-black">{item.state}</span>
//                   </div>
//                   <div className="mt-1 text-sm text-slate-300">{item.meta}</div>
//                   <div className="mt-2 text-xs text-slate-400">{item.time}</div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       </div>

//       <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
//         <div className="rounded-[24px] border border-black bg-white p-6 shadow-sm">
//           <div className="flex items-center justify-between gap-3">
//             <div>
//               <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-500">Performance</div>
//               <h3 className="mt-1 text-lg font-semibold text-black">Call volume and sentiment</h3>
//             </div>
//             <Link to={`${basePath}/analytics`} className="text-sm font-medium text-orange-600 hover:underline">View analytics</Link>
//           </div>

//           <div className="mt-5 grid gap-4 sm:grid-cols-3">
//             <Stat label="Calls" value={displayCallStats?.total_calls ?? displayStats?.callsAllTime ?? '—'} />
//             <Stat label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '—'} />
//             <Stat label="Avg duration" value={displayCallStats?.avg_duration_seconds != null ? fmtDuration(displayCallStats.avg_duration_seconds) : fmtDuration(displayStats?.avgDurationSec || 0)} />
//           </div>

//           {displaySentiment && (
//             <div className="mt-6 rounded-2xl border border-black bg-black p-4">
//               <div className="flex items-center justify-between gap-3">
//                 <div className="text-sm font-semibold text-white">Caller sentiment</div>
//                 {!!displaySentiment.needFollowUp && (
//                   <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-black">
//                     {displaySentiment.needFollowUp} need follow-up
//                   </span>
//                 )}
//               </div>
//               <div className="mt-3 flex items-end gap-2">
//                 <div className="text-3xl font-semibold text-white">{displaySentiment.sentiment_percentages?.positive ?? 0}%</div>
//                 <div className="text-sm text-slate-300">positive</div>
//               </div>
//               <div className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden flex">
//                 <div className="h-2 bg-orange-500" style={{ width: `${displaySentiment.sentiment_percentages?.positive ?? 0}%` }} />
//                 <div className="h-2 bg-slate-400" style={{ width: `${displaySentiment.sentiment_percentages?.neutral ?? 0}%` }} />
//                 <div className="h-2 bg-white" style={{ width: `${displaySentiment.sentiment_percentages?.negative ?? 0}%` }} />
//               </div>
//             </div>
//           )}

//           {volumeBars.length > 0 && (
//             <div className="mt-6">
//               <div className="text-sm font-semibold text-black">Call volume · last 7 days</div>
//               <div className="mt-4 flex items-end gap-2">
//                 {volumeBars.map((d) => {
//                   const max = Math.max(1, ...volumeBars.map((x) => Number(x.count || x.calls || 0)));
//                   const v = Number(d.count || d.calls || 0);
//                   const barPx = Math.max(10, Math.round((v / max) * 72));
//                   return (
//                     <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
//                       <div className="w-full rounded-t-2xl bg-orange-500" style={{ height: barPx }} />
//                       <div className="text-[11px] text-slate-500">{new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}</div>
//                     </div>
//                   );
//                 })}
//               </div>
//             </div>
//           )}
//         </div>

//         <div className="rounded-[24px] border border-black bg-white p-6 shadow-sm">
//           <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-500">Coverage</div>
//           <h3 className="mt-1 text-lg font-semibold text-black">Your voice setup</h3>
//           <div className="mt-4 space-y-3">
//             <div className="rounded-2xl border border-black bg-black p-4">
//               <div className="text-sm font-semibold text-white">Number ready</div>
//               <div className="mt-1 text-sm text-slate-300">{testNumber || currentUser?.number?.value || 'No number configured yet'}</div>
//             </div>
//             <div className="rounded-2xl border border-black bg-black p-4">
//               <div className="text-sm font-semibold text-white">Agent persona</div>
//               <div className="mt-1 text-sm text-slate-300">{currentUser?.agentName || 'Demo Agent'}</div>
//             </div>
//             <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4">
//               <div className="text-sm font-semibold text-orange-700">Next action</div>
//               <div className="mt-1 text-sm text-slate-600">Review your knowledge base and keep the greeting sharp for callers.</div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// function Stat({ label, value }) {
//   return (
//     <div className="rounded-2xl border border-black bg-black p-4">
//       <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-400">{label}</div>
//       <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
//     </div>
//   );
// }

// function MetricCard({ label, value, note }) {
//   return (
//     <div className="rounded-2xl border border-black bg-black p-4">
//       <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-400">{label}</div>
//       <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
//       <div className="mt-1 text-sm text-slate-300">{note}</div>
//     </div>
//   );
// }

// function ProvisioningBanner() {
//   const { currentUser } = useApp();
//   const [busy, setBusy] = useState(false);
//   const [msg, setMsg] = useState('');
//   const [localStatus, setLocalStatus] = useState(currentUser?.provisioning?.status || 'unprovisioned');
//   const [localErr, setLocalErr] = useState(currentUser?.provisioning?.error || null);

//   if (!currentUser?.number?.value) return null;

//   const status = localStatus;
//   const error = localErr;

//   const provision = async () => {
//     setBusy(true); setMsg('');
//     try {
//       const r = await api('/api/provision/me', { method: 'POST' });
//       setMsg('✓ ' + (r.log || []).join(' · '));
//       setLocalStatus('ready');
//       setLocalErr(null);
//     } catch (e) {
//       setMsg('✗ ' + e.message);
//       setLocalStatus('failed');
//       setLocalErr(e.message);
//     } finally {
//       setBusy(false);
//     }
//   };

//   if (status === 'ready') return null;

//   return (
//     <div className="mt-4 rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 flex items-start gap-3">
//       <Phone size={22} className="text-orange-600 flex-shrink-0" />
//       <div className="flex-1">
//         <div className="font-semibold text-orange-700">
//           Inbound calling: {status === 'in_progress' ? 'in progress…' : status === 'failed' ? 'failed' : 'not provisioned yet'}
//         </div>
//         <p className="text-sm text-slate-600 mt-1">
//           {status === 'failed'
//             ? <>Last error: {error || 'unknown'}. Retry to recreate the SIP trunk + dispatch rule + agent on 9278.</>
//             : <>Click below to set up your inbound calling, routing, and voice agent.</>
//           }
//         </p>
//         <div className="mt-3 flex items-center gap-2">
//           <button className="btn-ghost btn-ghost-accent text-sm" onClick={provision} disabled={busy}>
//             {busy ? 'Provisioning…' : 'Provision inbound now'}
//           </button>
//           {msg && <span className="text-xs text-mute">{msg}</span>}
//         </div>
//       </div>
//     </div>
//   );
// }



// import { useEffect, useState } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { AlarmClock, Zap, Phone, AlertTriangle, LayoutDashboard, RefreshCw, TrendingUp } from 'lucide-react';
// import { useApp } from '../../AppContext.jsx';
// import { api } from '../../api.js';
// import { readCache, writeCache } from '../../utils/swrCache.js';

// // Orange / white / black palette used for inline styling throughout this
// // page. Kept as plain hex here (rather than the shared --primary/green CSS
// // vars in index.css) so Overview stays visually independent of the rest of
// // the app's lime theme, per request — only this file changes.
// const THEME = {
//   orange: '#ff6a00',
//   orangeSoft: 'rgba(255,106,0,0.10)',
//   orangeBorder: 'rgba(255,106,0,0.35)',
//   black: '#0b0b0b',
//   white: '#ffffff',
//   ink3: '#8a93a6',
// };

// const fmtDuration = (s) => {
//   if (!s) return '0s';
//   const m = Math.floor(s / 60);
//   const sec = s % 60;
//   return m ? `${m}m ${sec}s` : `${sec}s`;
// };

// const fmtDate = (iso) => {
//   if (!iso) return '—';
//   try {
//     return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' });
//   } catch {
//     return '—';
//   }
// };

// export default function Overview({ rechargeOn }) {
//   const { currentUser } = useApp();
//   const navigate = useNavigate();
//   const [stats, setStats] = useState(() => readCache('overview.stats', currentUser?.id));
//   const [statsErr, setStatsErr] = useState('');
//   const [statsLoading, setStatsLoading] = useState(true);

//   const [wallet, setWallet] = useState(() => readCache('overview.wallet', currentUser?.id));
//   const [topupBusy, setTopupBusy] = useState(false);
//   const [topupMsg, setTopupMsg] = useState('');
//   const [numbers, setNumbers] = useState(() => readCache('overview.numbers', currentUser?.id) ?? []);
//   const [numbersLoading, setNumbersLoading] = useState(true);

//   // Call analytics card — call-statistics / sentiment / call-volume are all
//   // auto-scoped to this customer's own agent server-side (PER_AGENT_TOOLS in
//   // server/index.js), so they're safe to call directly, unlike /api/mcp/overview
//   // which is tenant-wide and stays admin-only.
//   const [callStats, setCallStats] = useState(() => readCache('overview.callStats', currentUser?.id));
//   const [sentiment, setSentiment] = useState(() => readCache('overview.sentiment', currentUser?.id));
//   const [volume, setVolume] = useState(() => readCache('overview.volume', currentUser?.id));

//   const refreshWallet = async () => {
//     try {
//       const w = await api('/api/wallet');
//       setWallet(w.wallet);
//       writeCache('overview.wallet', currentUser?.id, w.wallet);
//     } catch { }
//   };

//   useEffect(() => {
//     let cancelled = false;

//     // Each request fires immediately (nothing here is awaited before the
//     // next starts) and updates its own state the moment it resolves — so
//     // e.g. the numbers table paints as soon as /api/numbers is back instead
//     // of waiting on /api/twilio/stats, which is the slowest of the six.
//     api('/api/twilio/stats')
//       .then((data) => {
//         if (cancelled) return;
//         setStats(data);
//         writeCache('overview.stats', currentUser?.id, data);
//       })
//       .catch((e) => { if (!cancelled) setStatsErr(e.message); })
//       .finally(() => { if (!cancelled) setStatsLoading(false); });

//     api('/api/wallet')
//       .then((w) => {
//         if (cancelled) return;
//         setWallet(w.wallet);
//         writeCache('overview.wallet', currentUser?.id, w.wallet);
//       })
//       .catch(() => { });

//     api('/api/numbers')
//       .then((r) => {
//         if (cancelled) return;
//         const next = r.numbers || [];
//         setNumbers(next);
//         writeCache('overview.numbers', currentUser?.id, next);
//       })
//       .catch(() => { })
//       .finally(() => { if (!cancelled) setNumbersLoading(false); });

//     // These three were previously grouped in one Promise.all, so the volume
//     // chart couldn't paint until call-statistics AND sentiment also
//     // finished — even when call-volume itself came back fast. Now each
//     // fires independently and updates its own state the instant it
//     // resolves, same as the four requests above.
//     api('/api/mcp/call-statistics?days=30')
//       .then((cs) => {
//         if (cancelled) return;
//         const csData = cs?.data || null;
//         setCallStats(csData);
//         writeCache('overview.callStats', currentUser?.id, csData);
//       })
//       .catch(() => { });

//     api('/api/mcp/sentiment?days=30')
//       .then((sent) => {
//         if (cancelled) return;
//         const sentData = sent?.data || null;
//         setSentiment(sentData);
//         writeCache('overview.sentiment', currentUser?.id, sentData);
//       })
//       .catch(() => { });

//     api('/api/mcp/call-volume?days=14')
//       .then((vol) => {
//         if (cancelled) return;
//         const volData = vol?.data || null;
//         setVolume(volData);
//         writeCache('overview.volume', currentUser?.id, volData);
//       })
//       .catch(() => { });

//     return () => { cancelled = true; };
//   }, [currentUser?.role]);

//   const quickTopUp = async () => {
//     setTopupBusy(true);
//     setTopupMsg('');
//     try {
//       const r = await api('/api/wallet/topup', { method: 'POST', body: { pack: 'starter' } });
//       setTopupMsg(`✓ +${r.charged.minutes} min added · charged $${Number(r.charged.amountUsd || 0).toLocaleString('en-US')} to ${r.charged.descriptor}`);
//       await refreshWallet();
//     } catch (e) {
//       setTopupMsg(`✗ ${e.message}`);
//     } finally {
//       setTopupBusy(false);
//     }
//   };

//   if (!currentUser) return null;

//   const displayNumbers = numbers;
//   const displayStats = stats;
//   const displayCallStats = callStats;
//   const displaySentiment = sentiment;
//   const displayVolume = volume;

//   const planMin = currentUser.plan?.min || 0;
//   const minUsedAllTime = displayStats?.minutesUsedAllTime ?? Number(currentUser.minutesUsed) ?? 0;
//   const minUsedMonth = displayStats?.minutesUsedThisMonth ?? 0;
//   const planLeft = Math.max(0, planMin - minUsedAllTime);
//   const walletMin = wallet?.walletMinutes ?? currentUser.walletMinutes ?? 0;
//   const minLeft = Math.max(0, planLeft + walletMin);
//   const minTotal = planMin + walletMin;
//   const lowThreshold = wallet?.lowBalanceThreshold ?? currentUser.lowBalanceThreshold ?? 20;
//   const isLow = displayNumbers.length > 0 && minLeft <= lowThreshold;
//   const autoTopupOn = wallet?.autoTopupEnabled ?? currentUser.autoTopupEnabled;

//   // Proactive "renews soon" nudge — only meaningful for a single-number
//   // account (a multi-number account has staggered renewal dates, so one
//   // countdown wouldn't represent all of them). Shown in demo mode too since
//   // it's purely navigational (no charge risk), unlike the low-minutes banner.
//   const nextRenewal = displayNumbers[0]?.nextRentalAt ? new Date(displayNumbers[0].nextRentalAt) : null;
//   const daysUntilRenewal = nextRenewal && !isNaN(nextRenewal.getTime())
//     ? Math.ceil((nextRenewal.getTime() - Date.now()) / 86400000)
//     : null;
//   const renewalSoon = displayNumbers.length === 1 && daysUntilRenewal != null && daysUntilRenewal <= 7;

//   // Per-row usage breakdown is only exact when the customer has a single DID
//   // — /api/twilio/stats aggregates across every number, so with more than
//   // one it can't be attributed to a specific row without new backend work.
//   const singleNumber = displayNumbers.length === 1;

//   const testNumber = displayNumbers[0]?.value || currentUser.number?.value;

//   // This component renders under both /dashboard (Customer) and /admin
//   // (Admin/Superadmin, since they share the same Overview page) — links must
//   // resolve against whichever shell is actually mounted.
//   const isAdminTier =
//     currentUser.userType === 'superadmin'
//     || currentUser.userType === 'admin'
//     || currentUser.role === 'admin';
//   const basePath = isAdminTier ? '/admin' : '/dashboard';

//   // Dummy activity data — refreshed sample entries, each tagged with a
//   // status color (orange / black / white-on-black) rendered via inline
//   // style rather than a shared CSS class.
//   const activityFeed = [
//     { title: 'Inbound call answered', meta: 'Front desk line • 3m 42s', time: '6 min ago', state: 'Completed', tone: 'orange' },
//     { title: 'Auto top-up triggered', meta: '120 minutes added to your wallet', time: '2 hr ago', state: 'Success', tone: 'black' },
//     { title: 'Missed call flagged', meta: 'Caller requested a callback', time: '5 hr ago', state: 'Needs review', tone: 'outline' },
//     { title: 'Knowledge base refreshed', meta: 'Pricing FAQ synced from source doc', time: 'Yesterday', state: 'Updated', tone: 'black' },
//   ];

//   const stateStyles = {
//     orange: { backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` },
//     black: { backgroundColor: THEME.black, color: THEME.white, border: `1px solid ${THEME.black}` },
//     outline: { backgroundColor: 'transparent', color: THEME.orange, border: `1px solid ${THEME.orange}` },
//   };

//   const volumeBars = (displayVolume?.daily_breakdown || []).slice(-7);

//   return (
//     <div className="space-y-6">
//       {statsErr && (
//         <div
//           className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
//           style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft, color: THEME.orange }}
//         >
//           <AlertTriangle size={12} /> Live stats unavailable: {statsErr}
//         </div>
//       )}

//       <ProvisioningBanner />

//       {isLow && (
//         <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//           <AlarmClock size={20} style={{ color: THEME.orange, flexShrink: 0 }} />
//           <div className="flex-1">
//             <div className="font-semibold" style={{ color: THEME.orange }}>Low minutes — only {minLeft.toFixed(1)} left</div>
//             <p className="text-sm mt-1" style={{ color: THEME.black }}>
//               You are at or below your low-balance threshold ({lowThreshold} min). Top up now to keep your agent active.
//             </p>
//             <div className="mt-3 flex flex-wrap gap-2">
//               {!autoTopupOn && (
//                 <button
//                   className="text-sm inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-medium transition-colors"
//                   style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
//                   onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.orange; e.currentTarget.style.color = THEME.white; }}
//                   onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.white; e.currentTarget.style.color = THEME.orange; }}
//                   onClick={quickTopUp}
//                   disabled={topupBusy}
//                 >
//                   {topupBusy ? 'Charging…' : <><Zap size={14} /> Top up 83 min</>}
//                 </button>
//               )}
//               <Link
//                 to={`${basePath}/billing`}
//                 className="text-sm rounded-full px-4 py-2 font-medium"
//                 style={{ backgroundColor: THEME.white, color: THEME.black, border: `1px solid ${THEME.black}` }}
//               >
//                 Manage wallet →
//               </Link>
//               {topupMsg && <span className="text-xs ml-2 self-center" style={{ color: THEME.ink3 }}>{topupMsg}</span>}
//             </div>
//           </div>
//         </div>
//       )}

//       {renewalSoon && (
//         <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//           <RefreshCw size={20} style={{ color: THEME.orange, flexShrink: 0 }} />
//           <div className="flex-1">
//             <div className="font-semibold" style={{ color: THEME.orange }}>
//               {daysUntilRenewal <= 0 ? 'Plan renewal is due' : `Plan renews in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? '' : 's'}`}
//             </div>
//             <p className="text-sm mt-1" style={{ color: THEME.black }}>
//               Your {displayNumbers[0]?.plan?.label || 'current'} plan renews on {fmtDate(nextRenewal)}. Upgrade now to keep your availability steady.
//             </p>
//             <div className="mt-3 flex flex-wrap gap-2">
//               <Link
//                 to={`${basePath}/billing?tab=plans`}
//                 className="text-sm inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-medium"
//                 style={{ backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` }}
//               >
//                 <TrendingUp size={14} /> Upgrade plan
//               </Link>
//               <Link
//                 to={`${basePath}/billing`}
//                 className="text-sm rounded-full px-4 py-2 font-medium"
//                 style={{ backgroundColor: THEME.white, color: THEME.black, border: `1px solid ${THEME.black}` }}
//               >
//                 Manage plan →
//               </Link>
//             </div>
//           </div>
//         </div>
//       )}

//       <div className="rounded-[28px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//         <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
//           <div>
//             <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.orange }}>Account overview</div>
//             <h2 className="mt-2 font-display text-2xl font-semibold" style={{ color: THEME.white }}>Good morning, {currentUser?.name || 'Demo User'}</h2>
//             <p className="mt-2 max-w-2xl text-sm" style={{ color: '#e5e5e5' }}>
//               Your voice agent is active and your numbers are performing well. This snapshot highlights minute balance, recent activity, and the next best action.
//             </p>
//           </div>
//           <div className="rounded-2xl px-4 py-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//             <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>Primary number</div>
//             <div className="mt-1 font-semibold" style={{ color: THEME.black }}>{testNumber || currentUser?.number?.value || '—'}</div>
//             <div className="mt-1 text-sm" style={{ color: '#586379' }}>{currentUser?.plan?.label || 'Demo Plan'}</div>
//           </div>
//         </div>

//         <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
//           <MetricCard label="Minutes left" value={`${minLeft.toFixed(0)} min`} note={`${minTotal.toFixed(0)} available`} />
//           <MetricCard label="Calls today" value={displayStats?.callsToday ?? 12} note="Live activity" />
//           <MetricCard label="Monthly minutes" value={fmtDuration((displayStats?.minutesUsedThisMonth || 340) * 60)} note="This month" />
//           <MetricCard label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '94%'} note="Last 30 days" />
//         </div>
//       </div>

//       <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
//         <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.white }}>
//           <div className="flex items-center justify-between gap-3">
//             <div>
//               <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.orange }}>Minutes & plan</div>
//               <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Your current plan balance</h3>
//             </div>
//             <Link to={`${basePath}/billing`} className="text-sm font-medium hover:underline" style={{ color: THEME.orange }}>Manage plan</Link>
//           </div>

//           <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//             <div className="flex items-center justify-between text-sm" style={{ color: '#cbd5e1' }}>
//               <span>Included minutes</span>
//               <span className="font-semibold" style={{ color: THEME.white }}>{planMin.toFixed(0)} min</span>
//             </div>
//             <div className="mt-3 h-2 rounded-full" style={{ backgroundColor: '#262626' }}>
//               <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (minLeft / Math.max(1, minTotal)) * 100)}%`, backgroundColor: THEME.orange }} />
//             </div>
//             <div className="mt-3 flex items-center justify-between text-sm" style={{ color: '#cbd5e1' }}>
//               <span>{minLeft.toFixed(0)} minutes remaining</span>
//               <span>{minUsedAllTime.toFixed(0)} used so far</span>
//             </div>
//           </div>

//           <div className="mt-5 grid gap-3 sm:grid-cols-3">
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>Wallet balance</div>
//               <div className="mt-2 text-xl font-semibold" style={{ color: THEME.white }}>{walletMin.toFixed(0)} min</div>
//               <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>{wallet?.walletUsd ?? currentUser?.walletUsd ?? 240} USD available</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>Auto top-up</div>
//               <div className="mt-2 text-xl font-semibold" style={{ color: THEME.white }}>{autoTopupOn ? 'Enabled' : 'Off'}</div>
//               <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>Keep service running without interruptions</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>Plan renews</div>
//               <div className="mt-2 text-xl font-semibold" style={{ color: THEME.white }}>{fmtDate(nextRenewal) !== '—' ? fmtDate(nextRenewal) : '18 Sep'}</div>
//               <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>Next billing cycle</div>
//             </div>
//           </div>

//           <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//             <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>Plan details</div>
//             <div className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-4">
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Plan name</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>{currentUser?.plan?.label || 'Growth Plan'}</div>
//               </div>
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Billing cycle</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>Monthly</div>
//               </div>
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Cost per minute</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>$0.09</div>
//               </div>
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Rollover minutes</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>45 min</div>
//               </div>
//             </div>
//           </div>

//           <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-4">
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.black}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>62 min</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Used this week</div>
//             </div>
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.black}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>11 min</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Used yesterday</div>
//             </div>
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.black}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>3.4 min</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Avg call length</div>
//             </div>
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.black}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>$30.60</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Est. cost this month</div>
//             </div>
//           </div>
//         </div>

//         <div className="space-y-6">
//           <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.white }}>
//             <div className="flex items-center justify-between gap-3">
//               <div>
//                 <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.orange }}>Quick actions</div>
//                 <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Keep the experience moving</h3>
//               </div>
//             </div>
//             <div className="mt-4 grid gap-3">
//               <Link to={`${basePath}/agents`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.black, color: THEME.white, border: `1px solid ${THEME.black}` }}>Edit agent</Link>
//               <Link to={`${basePath}/billing`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` }}>Buy more minutes</Link>
//               <Link to={`${basePath}/analytics`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.white, color: THEME.black, border: `1px solid ${THEME.black}` }}>View analytics</Link>
//             </div>
//           </div>

//           <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.white }}>
//             <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.orange }}>Recent activity</div>
//             <div className="mt-4 space-y-3">
//               {activityFeed.map((item) => (
//                 <div key={item.title} className="rounded-2xl p-3" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//                   <div className="flex items-center justify-between gap-3">
//                     <div className="font-medium" style={{ color: THEME.white }}>{item.title}</div>
//                     <span
//                       className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
//                       style={stateStyles[item.tone] || stateStyles.black}
//                     >
//                       {item.state}
//                     </span>
//                   </div>
//                   <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>{item.meta}</div>
//                   <div className="mt-2 text-xs" style={{ color: '#8a93a6' }}>{item.time}</div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       </div>

//       <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
//         <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.white }}>
//           <div className="flex items-center justify-between gap-3">
//             <div>
//               <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.orange }}>Performance</div>
//               <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Call volume and sentiment</h3>
//             </div>
//             <Link to={`${basePath}/analytics`} className="text-sm font-medium hover:underline" style={{ color: THEME.orange }}>View analytics</Link>
//           </div>

//           <div className="mt-5 grid gap-4 sm:grid-cols-3">
//             <Stat label="Calls" value={displayCallStats?.total_calls ?? displayStats?.callsAllTime ?? 218} />
//             <Stat label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '94%'} />
//             <Stat label="Avg duration" value={displayCallStats?.avg_duration_seconds != null ? fmtDuration(displayCallStats.avg_duration_seconds) : fmtDuration(displayStats?.avgDurationSec || 154)} />
//           </div>

//           {displaySentiment && (
//             <div className="mt-6 rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//               <div className="flex items-center justify-between gap-3">
//                 <div className="text-sm font-semibold" style={{ color: THEME.white }}>Caller sentiment</div>
//                 {!!displaySentiment.needFollowUp && (
//                   <span className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ backgroundColor: THEME.orange, color: THEME.white }}>
//                     {displaySentiment.needFollowUp} need follow-up
//                   </span>
//                 )}
//               </div>
//               <div className="mt-3 flex items-end gap-2">
//                 <div className="text-3xl font-semibold" style={{ color: THEME.white }}>{displaySentiment.sentiment_percentages?.positive ?? 0}%</div>
//                 <div className="text-sm" style={{ color: '#cbd5e1' }}>positive</div>
//               </div>
//               <div className="mt-3 h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: '#262626' }}>
//                 <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.positive ?? 0}%`, backgroundColor: THEME.orange }} />
//                 <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.neutral ?? 0}%`, backgroundColor: '#8a93a6' }} />
//                 <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.negative ?? 0}%`, backgroundColor: THEME.white }} />
//               </div>
//             </div>
//           )}

//           {volumeBars.length > 0 && (
//             <div className="mt-6">
//               <div className="text-sm font-semibold" style={{ color: THEME.black }}>Call volume · last 7 days</div>
//               <div className="mt-4 flex items-end gap-2">
//                 {volumeBars.map((d) => {
//                   const max = Math.max(1, ...volumeBars.map((x) => Number(x.count || x.calls || 0)));
//                   const v = Number(d.count || d.calls || 0);
//                   const barPx = Math.max(10, Math.round((v / max) * 72));
//                   return (
//                     <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
//                       <div className="w-full rounded-t-2xl" style={{ height: barPx, backgroundColor: THEME.orange }} />
//                       <div className="text-[11px]" style={{ color: '#586379' }}>{new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}</div>
//                     </div>
//                   );
//                 })}
//               </div>
//             </div>
//           )}
//         </div>

//         <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.white }}>
//           <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.orange }}>Coverage</div>
//           <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Your voice setup</h3>
//           <div className="mt-4 space-y-3">
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//               <div className="text-sm font-semibold" style={{ color: THEME.white }}>Number ready</div>
//               <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>{testNumber || currentUser?.number?.value || 'No number configured yet'}</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//               <div className="text-sm font-semibold" style={{ color: THEME.white }}>Agent persona</div>
//               <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>{currentUser?.agentName || 'Demo Agent'}</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//               <div className="text-sm font-semibold" style={{ color: THEME.orange }}>Next action</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.black }}>Review your knowledge base and keep the greeting sharp for callers.</div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// function Stat({ label, value }) {
//   return (
//     <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//       <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>{label}</div>
//       <div className="mt-1 text-2xl font-semibold" style={{ color: THEME.white }}>{value}</div>
//     </div>
//   );
// }

// function MetricCard({ label, value, note }) {
//   return (
//     <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.black}`, backgroundColor: THEME.black }}>
//       <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.orange }}>{label}</div>
//       <div className="mt-2 text-2xl font-semibold" style={{ color: THEME.white }}>{value}</div>
//       <div className="mt-1 text-sm" style={{ color: '#cbd5e1' }}>{note}</div>
//     </div>
//   );
// }

// function ProvisioningBanner() {
//   const { currentUser } = useApp();
//   const [busy, setBusy] = useState(false);
//   const [msg, setMsg] = useState('');
//   const [localStatus, setLocalStatus] = useState(currentUser?.provisioning?.status || 'unprovisioned');
//   const [localErr, setLocalErr] = useState(currentUser?.provisioning?.error || null);

//   if (!currentUser?.number?.value) return null;

//   const status = localStatus;
//   const error = localErr;

//   const provision = async () => {
//     setBusy(true); setMsg('');
//     try {
//       const r = await api('/api/provision/me', { method: 'POST' });
//       setMsg('✓ ' + (r.log || []).join(' · '));
//       setLocalStatus('ready');
//       setLocalErr(null);
//     } catch (e) {
//       setMsg('✗ ' + e.message);
//       setLocalStatus('failed');
//       setLocalErr(e.message);
//     } finally {
//       setBusy(false);
//     }
//   };

//   if (status === 'ready') return null;

//   return (
//     <div className="mt-4 rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//       <Phone size={22} style={{ color: THEME.orange, flexShrink: 0 }} />
//       <div className="flex-1">
//         <div className="font-semibold" style={{ color: THEME.orange }}>
//           Inbound calling: {status === 'in_progress' ? 'in progress…' : status === 'failed' ? 'failed' : 'not provisioned yet'}
//         </div>
//         <p className="text-sm mt-1" style={{ color: THEME.black }}>
//           {status === 'failed'
//             ? <>Last error: {error || 'unknown'}. Retry to recreate the SIP trunk + dispatch rule + agent on 9278.</>
//             : <>Click below to set up your inbound calling, routing, and voice agent.</>
//           }
//         </p>
//         <div className="mt-3 flex items-center gap-2">
//           <button
//             className="text-sm rounded-full px-4 py-2 font-medium transition-colors"
//             style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
//             onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.orange; e.currentTarget.style.color = THEME.white; }}
//             onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.white; e.currentTarget.style.color = THEME.orange; }}
//             onClick={provision}
//             disabled={busy}
//           >
//             {busy ? 'Provisioning…' : 'Provision inbound now'}
//           </button>
//           {msg && <span className="text-xs" style={{ color: THEME.ink3 }}>{msg}</span>}
//         </div>
//       </div>
//     </div>
//   );
// }















// import { useEffect, useState } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { AlarmClock, Zap, Phone, AlertTriangle, LayoutDashboard, RefreshCw, TrendingUp } from 'lucide-react';
// import { useApp } from '../../AppContext.jsx';
// import { api } from '../../api.js';
// import { readCache, writeCache } from '../../utils/swrCache.js';

// // Light-orange palette used for inline styling throughout this page. Dark
// // orange is reserved ONLY for clickable elements (buttons/links) — every
// // other surface uses light-orange fills/borders with dark text, no black
// // backgrounds. Kept as plain hex here (rather than the shared --primary/green
// // CSS vars in index.css) so Overview stays visually independent — only this
// // file changes.
// const THEME = {
//   orange: '#c2410c',          // dark orange — CLICKABLE elements only (buttons, links, hover)
//   orangeHover: '#9a3412',     // darker orange — hover state for clickable elements
//   soft: '#fff4e8',            // light orange — default card/panel background
//   softStrong: '#ffe4c7',      // slightly stronger light orange — progress tracks, dividers
//   orangeSoft: 'rgba(194,65,12,0.08)',
//   orangeBorder: 'rgba(194,65,12,0.25)',
//   black: '#1c1917',           // dark text (not used as a background anymore)
//   white: '#ffffff',
//   muted: '#78716c',
//   ink3: '#8a93a6',
// };

// const fmtDuration = (s) => {
//   if (!s) return '0s';
//   const m = Math.floor(s / 60);
//   const sec = s % 60;
//   return m ? `${m}m ${sec}s` : `${sec}s`;
// };

// const fmtDate = (iso) => {
//   if (!iso) return '—';
//   try {
//     return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' });
//   } catch {
//     return '—';
//   }
// };

// export default function Overview({ rechargeOn }) {
//   const { currentUser } = useApp();
//   const navigate = useNavigate();
//   const [stats, setStats] = useState(() => readCache('overview.stats', currentUser?.id));
//   const [statsErr, setStatsErr] = useState('');
//   const [statsLoading, setStatsLoading] = useState(true);

//   const [wallet, setWallet] = useState(() => readCache('overview.wallet', currentUser?.id));
//   const [topupBusy, setTopupBusy] = useState(false);
//   const [topupMsg, setTopupMsg] = useState('');
//   const [numbers, setNumbers] = useState(() => readCache('overview.numbers', currentUser?.id) ?? []);
//   const [numbersLoading, setNumbersLoading] = useState(true);

//   // Call analytics card — call-statistics / sentiment / call-volume are all
//   // auto-scoped to this customer's own agent server-side (PER_AGENT_TOOLS in
//   // server/index.js), so they're safe to call directly, unlike /api/mcp/overview
//   // which is tenant-wide and stays admin-only.
//   const [callStats, setCallStats] = useState(() => readCache('overview.callStats', currentUser?.id));
//   const [sentiment, setSentiment] = useState(() => readCache('overview.sentiment', currentUser?.id));
//   const [volume, setVolume] = useState(() => readCache('overview.volume', currentUser?.id));

//   const refreshWallet = async () => {
//     try {
//       const w = await api('/api/wallet');
//       setWallet(w.wallet);
//       writeCache('overview.wallet', currentUser?.id, w.wallet);
//     } catch { }
//   };

//   useEffect(() => {
//     let cancelled = false;

//     // Each request fires immediately (nothing here is awaited before the
//     // next starts) and updates its own state the moment it resolves — so
//     // e.g. the numbers table paints as soon as /api/numbers is back instead
//     // of waiting on /api/twilio/stats, which is the slowest of the six.
//     api('/api/twilio/stats')
//       .then((data) => {
//         if (cancelled) return;
//         setStats(data);
//         writeCache('overview.stats', currentUser?.id, data);
//       })
//       .catch((e) => { if (!cancelled) setStatsErr(e.message); })
//       .finally(() => { if (!cancelled) setStatsLoading(false); });

//     api('/api/wallet')
//       .then((w) => {
//         if (cancelled) return;
//         setWallet(w.wallet);
//         writeCache('overview.wallet', currentUser?.id, w.wallet);
//       })
//       .catch(() => { });

//     api('/api/numbers')
//       .then((r) => {
//         if (cancelled) return;
//         const next = r.numbers || [];
//         setNumbers(next);
//         writeCache('overview.numbers', currentUser?.id, next);
//       })
//       .catch(() => { })
//       .finally(() => { if (!cancelled) setNumbersLoading(false); });

//     // These three were previously grouped in one Promise.all, so the volume
//     // chart couldn't paint until call-statistics AND sentiment also
//     // finished — even when call-volume itself came back fast. Now each
//     // fires independently and updates its own state the instant it
//     // resolves, same as the four requests above.
//     api('/api/mcp/call-statistics?days=30')
//       .then((cs) => {
//         if (cancelled) return;
//         const csData = cs?.data || null;
//         setCallStats(csData);
//         writeCache('overview.callStats', currentUser?.id, csData);
//       })
//       .catch(() => { });

//     api('/api/mcp/sentiment?days=30')
//       .then((sent) => {
//         if (cancelled) return;
//         const sentData = sent?.data || null;
//         setSentiment(sentData);
//         writeCache('overview.sentiment', currentUser?.id, sentData);
//       })
//       .catch(() => { });

//     api('/api/mcp/call-volume?days=14')
//       .then((vol) => {
//         if (cancelled) return;
//         const volData = vol?.data || null;
//         setVolume(volData);
//         writeCache('overview.volume', currentUser?.id, volData);
//       })
//       .catch(() => { });

//     return () => { cancelled = true; };
//   }, [currentUser?.role]);

//   const quickTopUp = async () => {
//     setTopupBusy(true);
//     setTopupMsg('');
//     try {
//       const r = await api('/api/wallet/topup', { method: 'POST', body: { pack: 'starter' } });
//       setTopupMsg(`✓ +${r.charged.minutes} min added · charged $${Number(r.charged.amountUsd || 0).toLocaleString('en-US')} to ${r.charged.descriptor}`);
//       await refreshWallet();
//     } catch (e) {
//       setTopupMsg(`✗ ${e.message}`);
//     } finally {
//       setTopupBusy(false);
//     }
//   };

//   if (!currentUser) return null;

//   const displayNumbers = numbers;
//   const displayStats = stats;
//   const displayCallStats = callStats;
//   const displaySentiment = sentiment;
//   const displayVolume = volume;

//   const planMin = currentUser.plan?.min || 0;
//   const minUsedAllTime = displayStats?.minutesUsedAllTime ?? Number(currentUser.minutesUsed) ?? 0;
//   const minUsedMonth = displayStats?.minutesUsedThisMonth ?? 0;
//   const planLeft = Math.max(0, planMin - minUsedAllTime);
//   const walletMin = wallet?.walletMinutes ?? currentUser.walletMinutes ?? 0;
//   const minLeft = Math.max(0, planLeft + walletMin);
//   const minTotal = planMin + walletMin;
//   const lowThreshold = wallet?.lowBalanceThreshold ?? currentUser.lowBalanceThreshold ?? 20;
//   const isLow = displayNumbers.length > 0 && minLeft <= lowThreshold;
//   const autoTopupOn = wallet?.autoTopupEnabled ?? currentUser.autoTopupEnabled;

//   // Proactive "renews soon" nudge — only meaningful for a single-number
//   // account (a multi-number account has staggered renewal dates, so one
//   // countdown wouldn't represent all of them). Shown in demo mode too since
//   // it's purely navigational (no charge risk), unlike the low-minutes banner.
//   const nextRenewal = displayNumbers[0]?.nextRentalAt ? new Date(displayNumbers[0].nextRentalAt) : null;
//   const daysUntilRenewal = nextRenewal && !isNaN(nextRenewal.getTime())
//     ? Math.ceil((nextRenewal.getTime() - Date.now()) / 86400000)
//     : null;
//   const renewalSoon = displayNumbers.length === 1 && daysUntilRenewal != null && daysUntilRenewal <= 7;

//   // Per-row usage breakdown is only exact when the customer has a single DID
//   // — /api/twilio/stats aggregates across every number, so with more than
//   // one it can't be attributed to a specific row without new backend work.
//   const singleNumber = displayNumbers.length === 1;

//   const testNumber = displayNumbers[0]?.value || currentUser.number?.value;

//   // This component renders under both /dashboard (Customer) and /admin
//   // (Admin/Superadmin, since they share the same Overview page) — links must
//   // resolve against whichever shell is actually mounted.
//   const isAdminTier =
//     currentUser.userType === 'superadmin'
//     || currentUser.userType === 'admin'
//     || currentUser.role === 'admin';
//   const basePath = isAdminTier ? '/admin' : '/dashboard';

//   // Dummy activity data — refreshed sample entries, each tagged with a
//   // status color (orange / black / white-on-black) rendered via inline
//   // style rather than a shared CSS class.
//   const activityFeed = [
//     { title: 'Inbound call answered', meta: 'Front desk line • 3m 42s', time: '6 min ago', state: 'Completed', tone: 'orange' },
//     { title: 'Auto top-up triggered', meta: '120 minutes added to your wallet', time: '2 hr ago', state: 'Success', tone: 'black' },
//     { title: 'Missed call flagged', meta: 'Caller requested a callback', time: '5 hr ago', state: 'Needs review', tone: 'outline' },
//     { title: 'Knowledge base refreshed', meta: 'Pricing FAQ synced from source doc', time: 'Yesterday', state: 'Updated', tone: 'black' },
//   ];

//   const stateStyles = {
//     orange: { backgroundColor: THEME.soft, color: THEME.black, border: `1px solid ${THEME.orangeBorder}` },
//     black: { backgroundColor: THEME.softStrong, color: THEME.black, border: `1px solid ${THEME.orangeBorder}` },
//     outline: { backgroundColor: 'transparent', color: THEME.black, border: `1px solid ${THEME.orangeBorder}` },
//   };

//   const volumeBars = (displayVolume?.daily_breakdown || []).slice(-7);

//   return (
//     <div className="space-y-6">
//       {statsErr && (
//         <div
//           className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
//           style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft, color: THEME.black }}
//         >
//           <AlertTriangle size={12} /> Live stats unavailable: {statsErr}
//         </div>
//       )}

//       <ProvisioningBanner />

//       {isLow && (
//         <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//           <AlarmClock size={20} style={{ color: THEME.black, flexShrink: 0 }} />
//           <div className="flex-1">
//             <div className="font-semibold" style={{ color: THEME.black }}>Low minutes — only {minLeft.toFixed(1)} left</div>
//             <p className="text-sm mt-1" style={{ color: THEME.black }}>
//               You are at or below your low-balance threshold ({lowThreshold} min). Top up now to keep your agent active.
//             </p>
//             <div className="mt-3 flex flex-wrap gap-2">
//               {!autoTopupOn && (
//                 <button
//                   className="text-sm inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-medium transition-colors"
//                   style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
//                   onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.orange; e.currentTarget.style.color = THEME.white; }}
//                   onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.white; e.currentTarget.style.color = THEME.orange; }}
//                   onClick={quickTopUp}
//                   disabled={topupBusy}
//                 >
//                   {topupBusy ? 'Charging…' : <><Zap size={14} /> Top up 83 min</>}
//                 </button>
//               )}
//               <Link
//                 to={`${basePath}/billing`}
//                 className="text-sm rounded-full px-4 py-2 font-medium"
//                 style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
//               >
//                 Manage wallet →
//               </Link>
//               {topupMsg && <span className="text-xs ml-2 self-center" style={{ color: THEME.ink3 }}>{topupMsg}</span>}
//             </div>
//           </div>
//         </div>
//       )}

//       {renewalSoon && (
//         <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//           <RefreshCw size={20} style={{ color: THEME.black, flexShrink: 0 }} />
//           <div className="flex-1">
//             <div className="font-semibold" style={{ color: THEME.black }}>
//               {daysUntilRenewal <= 0 ? 'Plan renewal is due' : `Plan renews in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? '' : 's'}`}
//             </div>
//             <p className="text-sm mt-1" style={{ color: THEME.black }}>
//               Your {displayNumbers[0]?.plan?.label || 'current'} plan renews on {fmtDate(nextRenewal)}. Upgrade now to keep your availability steady.
//             </p>
//             <div className="mt-3 flex flex-wrap gap-2">
//               <Link
//                 to={`${basePath}/billing?tab=plans`}
//                 className="text-sm inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-medium"
//                 style={{ backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` }}
//               >
//                 <TrendingUp size={14} /> Upgrade plan
//               </Link>
//               <Link
//                 to={`${basePath}/billing`}
//                 className="text-sm rounded-full px-4 py-2 font-medium"
//                 style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
//               >
//                 Manage plan →
//               </Link>
//             </div>
//           </div>
//         </div>
//       )}

//       <div className="rounded-[28px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//         <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
//           <div>
//             <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Account overview</div>
//             <h2 className="mt-2 font-display text-2xl font-semibold" style={{ color: THEME.black }}>Good morning, {currentUser?.name || 'Demo User'}</h2>
//             <p className="mt-2 max-w-2xl text-sm" style={{ color: THEME.muted }}>
//               Your voice agent is active and your numbers are performing well. This snapshot highlights minute balance, recent activity, and the next best action.
//             </p>
//           </div>
//           <div className="rounded-2xl px-4 py-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//             <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Primary number</div>
//             <div className="mt-1 font-semibold" style={{ color: THEME.black }}>{testNumber || currentUser?.number?.value || '—'}</div>
//             <div className="mt-1 text-sm" style={{ color: '#586379' }}>{currentUser?.plan?.label || 'Demo Plan'}</div>
//           </div>
//         </div>

//         <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
//           <MetricCard label="Minutes left" value={`${minLeft.toFixed(0)} min`} note={`${minTotal.toFixed(0)} available`} />
//           <MetricCard label="Calls today" value={displayStats?.callsToday ?? 12} note="Live activity" />
//           <MetricCard label="Monthly minutes" value={fmtDuration((displayStats?.minutesUsedThisMonth || 340) * 60)} note="This month" />
//           <MetricCard label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '94%'} note="Last 30 days" />
//         </div>
//       </div>

//       <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
//         <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//           <div className="flex items-center justify-between gap-3">
//             <div>
//               <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Minutes & plan</div>
//               <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Your current plan balance</h3>
//             </div>
//             <Link to={`${basePath}/billing`} className="text-sm font-medium hover:underline" style={{ color: THEME.orange }}>Manage plan</Link>
//           </div>

//           <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//             <div className="flex items-center justify-between text-sm" style={{ color: THEME.muted }}>
//               <span>Included minutes</span>
//               <span className="font-semibold" style={{ color: THEME.black }}>{planMin.toFixed(0)} min</span>
//             </div>
//             <div className="mt-3 h-2 rounded-full" style={{ backgroundColor: THEME.softStrong }}>
//               <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (minLeft / Math.max(1, minTotal)) * 100)}%`, backgroundColor: THEME.orange }} />
//             </div>
//             <div className="mt-3 flex items-center justify-between text-sm" style={{ color: THEME.muted }}>
//               <span>{minLeft.toFixed(0)} minutes remaining</span>
//               <span>{minUsedAllTime.toFixed(0)} used so far</span>
//             </div>
//           </div>

//           <div className="mt-5 grid gap-3 sm:grid-cols-3">
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Wallet balance</div>
//               <div className="mt-2 text-xl font-semibold" style={{ color: THEME.black }}>{walletMin.toFixed(0)} min</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{wallet?.walletUsd ?? currentUser?.walletUsd ?? 240} USD available</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Auto top-up</div>
//               <div className="mt-2 text-xl font-semibold" style={{ color: THEME.black }}>{autoTopupOn ? 'Enabled' : 'Off'}</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.muted }}>Keep service running without interruptions</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//               <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Plan renews</div>
//               <div className="mt-2 text-xl font-semibold" style={{ color: THEME.black }}>{fmtDate(nextRenewal) !== '—' ? fmtDate(nextRenewal) : '18 Sep'}</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.muted }}>Next billing cycle</div>
//             </div>
//           </div>

//           <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//             <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Plan details</div>
//             <div className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-4">
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Plan name</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>{currentUser?.plan?.label || 'Growth Plan'}</div>
//               </div>
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Billing cycle</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>Monthly</div>
//               </div>
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Cost per minute</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>$0.09</div>
//               </div>
//               <div>
//                 <div className="text-[11px]" style={{ color: '#586379' }}>Rollover minutes</div>
//                 <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>45 min</div>
//               </div>
//             </div>
//           </div>

//           <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-4">
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>62 min</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Used this week</div>
//             </div>
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>11 min</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Used yesterday</div>
//             </div>
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>3.4 min</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Avg call length</div>
//             </div>
//             <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
//               <div className="text-lg font-semibold" style={{ color: THEME.black }}>$30.60</div>
//               <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Est. cost this month</div>
//             </div>
//           </div>
//         </div>

//         <div className="space-y-6">
//           <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//             <div className="flex items-center justify-between gap-3">
//               <div>
//                 <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Quick actions</div>
//                 <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Keep the experience moving</h3>
//               </div>
//             </div>
//             <div className="mt-4 grid gap-3">
//               <Link to={`${basePath}/agents`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}>Edit agent</Link>
//               <Link to={`${basePath}/billing`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` }}>Buy more minutes</Link>
//               <Link to={`${basePath}/analytics`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}>View analytics</Link>
//             </div>
//           </div>

//           <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//             <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Recent activity</div>
//             <div className="mt-4 space-y-3">
//               {activityFeed.map((item) => (
//                 <div key={item.title} className="rounded-2xl p-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//                   <div className="flex items-center justify-between gap-3">
//                     <div className="font-medium" style={{ color: THEME.black }}>{item.title}</div>
//                     <span
//                       className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
//                       style={stateStyles[item.tone] || stateStyles.black}
//                     >
//                       {item.state}
//                     </span>
//                   </div>
//                   <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{item.meta}</div>
//                   <div className="mt-2 text-xs" style={{ color: '#8a93a6' }}>{item.time}</div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       </div>

//       <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
//         <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//           <div className="flex items-center justify-between gap-3">
//             <div>
//               <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Performance</div>
//               <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Call volume and sentiment</h3>
//             </div>
//             <Link to={`${basePath}/analytics`} className="text-sm font-medium hover:underline" style={{ color: THEME.orange }}>View analytics</Link>
//           </div>

//           <div className="mt-5 grid gap-4 sm:grid-cols-3">
//             <Stat label="Calls" value={displayCallStats?.total_calls ?? displayStats?.callsAllTime ?? 218} />
//             <Stat label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '94%'} />
//             <Stat label="Avg duration" value={displayCallStats?.avg_duration_seconds != null ? fmtDuration(displayCallStats.avg_duration_seconds) : fmtDuration(displayStats?.avgDurationSec || 154)} />
//           </div>

//           {displaySentiment && (
//             <div className="mt-6 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//               <div className="flex items-center justify-between gap-3">
//                 <div className="text-sm font-semibold" style={{ color: THEME.black }}>Caller sentiment</div>
//                 {!!displaySentiment.needFollowUp && (
//                   <span className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ backgroundColor: THEME.softStrong, color: THEME.black, border: `1px solid ${THEME.orangeBorder}` }}>
//                     {displaySentiment.needFollowUp} need follow-up
//                   </span>
//                 )}
//               </div>
//               <div className="mt-3 flex items-end gap-2">
//                 <div className="text-3xl font-semibold" style={{ color: THEME.black }}>{displaySentiment.sentiment_percentages?.positive ?? 0}%</div>
//                 <div className="text-sm" style={{ color: THEME.muted }}>positive</div>
//               </div>
//               <div className="mt-3 h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: THEME.softStrong }}>
//                 <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.positive ?? 0}%`, backgroundColor: THEME.orange }} />
//                 <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.neutral ?? 0}%`, backgroundColor: '#8a93a6' }} />
//                 <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.negative ?? 0}%`, backgroundColor: THEME.muted }} />
//               </div>
//             </div>
//           )}

//           {volumeBars.length > 0 && (
//             <div className="mt-6">
//               <div className="text-sm font-semibold" style={{ color: THEME.black }}>Call volume · last 7 days</div>
//               <div className="mt-4 flex items-end gap-2">
//                 {volumeBars.map((d) => {
//                   const max = Math.max(1, ...volumeBars.map((x) => Number(x.count || x.calls || 0)));
//                   const v = Number(d.count || d.calls || 0);
//                   const barPx = Math.max(10, Math.round((v / max) * 72));
//                   return (
//                     <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
//                       <div className="w-full rounded-t-2xl" style={{ height: barPx, backgroundColor: THEME.orange }} />
//                       <div className="text-[11px]" style={{ color: '#586379' }}>{new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}</div>
//                     </div>
//                   );
//                 })}
//               </div>
//             </div>
//           )}
//         </div>

//         <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
//           <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Coverage</div>
//           <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Your voice setup</h3>
//           <div className="mt-4 space-y-3">
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//               <div className="text-sm font-semibold" style={{ color: THEME.black }}>Number ready</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{testNumber || currentUser?.number?.value || 'No number configured yet'}</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//               <div className="text-sm font-semibold" style={{ color: THEME.black }}>Agent persona</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{currentUser?.agentName || 'Demo Agent'}</div>
//             </div>
//             <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//               <div className="text-sm font-semibold" style={{ color: THEME.black }}>Next action</div>
//               <div className="mt-1 text-sm" style={{ color: THEME.black }}>Review your knowledge base and keep the greeting sharp for callers.</div>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// function Stat({ label, value }) {
//   return (
//     <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//       <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>{label}</div>
//       <div className="mt-1 text-2xl font-semibold" style={{ color: THEME.black }}>{value}</div>
//     </div>
//   );
// }

// function MetricCard({ label, value, note }) {
//   return (
//     <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
//       <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>{label}</div>
//       <div className="mt-2 text-2xl font-semibold" style={{ color: THEME.black }}>{value}</div>
//       <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{note}</div>
//     </div>
//   );
// }

// function ProvisioningBanner() {
//   const { currentUser } = useApp();
//   const [busy, setBusy] = useState(false);
//   const [msg, setMsg] = useState('');
//   const [localStatus, setLocalStatus] = useState(currentUser?.provisioning?.status || 'unprovisioned');
//   const [localErr, setLocalErr] = useState(currentUser?.provisioning?.error || null);

//   if (!currentUser?.number?.value) return null;

//   const status = localStatus;
//   const error = localErr;

//   const provision = async () => {
//     setBusy(true); setMsg('');
//     try {
//       const r = await api('/api/provision/me', { method: 'POST' });
//       setMsg('✓ ' + (r.log || []).join(' · '));
//       setLocalStatus('ready');
//       setLocalErr(null);
//     } catch (e) {
//       setMsg('✗ ' + e.message);
//       setLocalStatus('failed');
//       setLocalErr(e.message);
//     } finally {
//       setBusy(false);
//     }
//   };

//   if (status === 'ready') return null;

//   return (
//     <div className="mt-4 rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
//       <Phone size={22} style={{ color: THEME.black, flexShrink: 0 }} />
//       <div className="flex-1">
//         <div className="font-semibold" style={{ color: THEME.black }}>
//           Inbound calling: {status === 'in_progress' ? 'in progress…' : status === 'failed' ? 'failed' : 'not provisioned yet'}
//         </div>
//         <p className="text-sm mt-1" style={{ color: THEME.black }}>
//           {status === 'failed'
//             ? <>Last error: {error || 'unknown'}. Retry to recreate the SIP trunk + dispatch rule + agent on 9278.</>
//             : <>Click below to set up your inbound calling, routing, and voice agent.</>
//           }
//         </p>
//         <div className="mt-3 flex items-center gap-2">
//           <button
//             className="text-sm rounded-full px-4 py-2 font-medium transition-colors"
//             style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
//             onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.orange; e.currentTarget.style.color = THEME.white; }}
//             onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.white; e.currentTarget.style.color = THEME.orange; }}
//             onClick={provision}
//             disabled={busy}
//           >
//             {busy ? 'Provisioning…' : 'Provision inbound now'}
//           </button>
//           {msg && <span className="text-xs" style={{ color: THEME.ink3 }}>{msg}</span>}
//         </div>
//       </div>
//     </div>
//   );
// }





import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, Zap, Phone, AlertTriangle, LayoutDashboard, RefreshCw, TrendingUp } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { readCache, writeCache } from '../../utils/swrCache.js';

// Light-orange palette used for inline styling throughout this page. Dark
// orange is reserved ONLY for clickable elements (buttons/links) — every
// other surface uses light-orange fills/borders with dark text, no black
// backgrounds. Kept as plain hex here (rather than the shared --primary/green
// CSS vars in index.css) so Overview stays visually independent — only this
// file changes.
const THEME = {
  orange: "#F97316",        // Primary Orange
  orangeHover: "#EA580C",   // Dark Orange
  orangeBorder: "#FED7AA",  // Light Orange Border
  soft: "#FFF7ED",          // Light Orange Background
  white: "#FFFFFF",
  black: "#111827",
  muted: "#6B7280",
};

const fmtDuration = (s) => {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' });
  } catch {
    return '—';
  }
};

export default function Overview({ rechargeOn }) {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [stats, setStats] = useState(() => readCache('overview.stats', currentUser?.id));
  const [statsErr, setStatsErr] = useState('');
  const [statsLoading, setStatsLoading] = useState(true);

  const [wallet, setWallet] = useState(() => readCache('overview.wallet', currentUser?.id));
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupMsg, setTopupMsg] = useState('');
  const [numbers, setNumbers] = useState(() => readCache('overview.numbers', currentUser?.id) ?? []);
  const [numbersLoading, setNumbersLoading] = useState(true);

  // Call analytics card — call-statistics / sentiment / call-volume are all
  // auto-scoped to this customer's own agent server-side (PER_AGENT_TOOLS in
  // server/index.js), so they're safe to call directly, unlike /api/mcp/overview
  // which is tenant-wide and stays admin-only.
  const [callStats, setCallStats] = useState(() => readCache('overview.callStats', currentUser?.id));
  const [sentiment, setSentiment] = useState(() => readCache('overview.sentiment', currentUser?.id));
  const [volume, setVolume] = useState(() => readCache('overview.volume', currentUser?.id));

  const refreshWallet = async () => {
    try {
      const w = await api('/api/wallet');
      setWallet(w.wallet);
      writeCache('overview.wallet', currentUser?.id, w.wallet);
    } catch { }
  };

  useEffect(() => {
    let cancelled = false;

    // Each request fires immediately (nothing here is awaited before the
    // next starts) and updates its own state the moment it resolves — so
    // e.g. the numbers table paints as soon as /api/numbers is back instead
    // of waiting on /api/twilio/stats, which is the slowest of the six.
    api('/api/twilio/stats')
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        writeCache('overview.stats', currentUser?.id, data);
      })
      .catch((e) => { if (!cancelled) setStatsErr(e.message); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });

    api('/api/wallet')
      .then((w) => {
        if (cancelled) return;
        setWallet(w.wallet);
        writeCache('overview.wallet', currentUser?.id, w.wallet);
      })
      .catch(() => { });

    api('/api/numbers')
      .then((r) => {
        if (cancelled) return;
        const next = r.numbers || [];
        setNumbers(next);
        writeCache('overview.numbers', currentUser?.id, next);
      })
      .catch(() => { })
      .finally(() => { if (!cancelled) setNumbersLoading(false); });

    // These three were previously grouped in one Promise.all, so the volume
    // chart couldn't paint until call-statistics AND sentiment also
    // finished — even when call-volume itself came back fast. Now each
    // fires independently and updates its own state the instant it
    // resolves, same as the four requests above.
    api('/api/mcp/call-statistics?days=30')
      .then((cs) => {
        if (cancelled) return;
        const csData = cs?.data || null;
        setCallStats(csData);
        writeCache('overview.callStats', currentUser?.id, csData);
      })
      .catch(() => { });

    api('/api/mcp/sentiment?days=30')
      .then((sent) => {
        if (cancelled) return;
        const sentData = sent?.data || null;
        setSentiment(sentData);
        writeCache('overview.sentiment', currentUser?.id, sentData);
      })
      .catch(() => { });

    api('/api/mcp/call-volume?days=14')
      .then((vol) => {
        if (cancelled) return;
        const volData = vol?.data || null;
        setVolume(volData);
        writeCache('overview.volume', currentUser?.id, volData);
      })
      .catch(() => { });

    return () => { cancelled = true; };
  }, [currentUser?.role]);

  const quickTopUp = async () => {
    setTopupBusy(true);
    setTopupMsg('');
    try {
      const r = await api('/api/wallet/topup', { method: 'POST', body: { pack: 'starter' } });
      setTopupMsg(`✓ +${r.charged.minutes} min added · charged $${Number(r.charged.amountUsd || 0).toLocaleString('en-US')} to ${r.charged.descriptor}`);
      await refreshWallet();
    } catch (e) {
      setTopupMsg(`✗ ${e.message}`);
    } finally {
      setTopupBusy(false);
    }
  };

  if (!currentUser) return null;

  const displayNumbers = numbers;
  const displayStats = stats;
  const displayCallStats = callStats;
  const displaySentiment = sentiment;
  const displayVolume = volume;

  const planMin = currentUser.plan?.min || 0;
  const minUsedAllTime = displayStats?.minutesUsedAllTime ?? Number(currentUser.minutesUsed) ?? 0;
  const minUsedMonth = displayStats?.minutesUsedThisMonth ?? 0;
  const planLeft = Math.max(0, planMin - minUsedAllTime);
  const walletMin = wallet?.walletMinutes ?? currentUser.walletMinutes ?? 0;
  const minLeft = Math.max(0, planLeft + walletMin);
  const minTotal = planMin + walletMin;
  const lowThreshold = wallet?.lowBalanceThreshold ?? currentUser.lowBalanceThreshold ?? 20;
  const isLow = displayNumbers.length > 0 && minLeft <= lowThreshold;
  const autoTopupOn = wallet?.autoTopupEnabled ?? currentUser.autoTopupEnabled;

  // Proactive "renews soon" nudge — only meaningful for a single-number
  // account (a multi-number account has staggered renewal dates, so one
  // countdown wouldn't represent all of them). Shown in demo mode too since
  // it's purely navigational (no charge risk), unlike the low-minutes banner.
  const nextRenewal = displayNumbers[0]?.nextRentalAt ? new Date(displayNumbers[0].nextRentalAt) : null;
  const daysUntilRenewal = nextRenewal && !isNaN(nextRenewal.getTime())
    ? Math.ceil((nextRenewal.getTime() - Date.now()) / 86400000)
    : null;
  const renewalSoon = displayNumbers.length === 1 && daysUntilRenewal != null && daysUntilRenewal <= 7;

  // Per-row usage breakdown is only exact when the customer has a single DID
  // — /api/twilio/stats aggregates across every number, so with more than
  // one it can't be attributed to a specific row without new backend work.
  const singleNumber = displayNumbers.length === 1;

  const testNumber = displayNumbers[0]?.value || currentUser.number?.value;

  // This component renders under both /dashboard (Customer) and /admin
  // (Admin/Superadmin, since they share the same Overview page) — links must
  // resolve against whichever shell is actually mounted.
  const isAdminTier =
    currentUser.userType === 'superadmin'
    || currentUser.userType === 'admin'
    || currentUser.role === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  // Dummy activity data — refreshed sample entries, each tagged with a
  // status color (orange / black / white-on-black) rendered via inline
  // style rather than a shared CSS class.
  const activityFeed = [
    { title: 'Inbound call answered', meta: 'Front desk line • 3m 42s', time: '6 min ago', state: 'Completed', tone: 'orange' },
    { title: 'Auto top-up triggered', meta: '120 minutes added to your wallet', time: '2 hr ago', state: 'Success', tone: 'black' },
    { title: 'Missed call flagged', meta: 'Caller requested a callback', time: '5 hr ago', state: 'Needs review', tone: 'outline' },
    { title: 'Knowledge base refreshed', meta: 'Pricing FAQ synced from source doc', time: 'Yesterday', state: 'Updated', tone: 'black' },
  ];

  const stateStyles = {
    orange: { backgroundColor: THEME.soft, color: THEME.black, border: `1px solid ${THEME.orangeBorder}` },
    black: { backgroundColor: THEME.softStrong, color: THEME.black, border: `1px solid ${THEME.orangeBorder}` },
    outline: { backgroundColor: 'transparent', color: THEME.black, border: `1px solid ${THEME.orangeBorder}` },
  };

  const volumeBars = (displayVolume?.daily_breakdown || []).slice(-7);

  return (
    <div className="space-y-6">
      {statsErr && (
        <div
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs"
          style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft, color: THEME.black }}
        >
          <AlertTriangle size={12} /> Live stats unavailable: {statsErr}
        </div>
      )}

      <ProvisioningBanner />

      {isLow && (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
          <AlarmClock size={20} style={{ color: THEME.black, flexShrink: 0 }} />
          <div className="flex-1">
            <div className="font-semibold" style={{ color: THEME.black }}>Low minutes — only {minLeft.toFixed(1)} left</div>
            <p className="text-sm mt-1" style={{ color: THEME.black }}>
              You are at or below your low-balance threshold ({lowThreshold} min). Top up now to keep your agent active.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!autoTopupOn && (
                <button
                  className="text-sm inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-medium transition-colors"
                  style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.orange; e.currentTarget.style.color = THEME.white; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.white; e.currentTarget.style.color = THEME.orange; }}
                  onClick={quickTopUp}
                  disabled={topupBusy}
                >
                  {topupBusy ? 'Charging…' : <><Zap size={14} /> Top up 83 min</>}
                </button>
              )}
              <Link
                to={`${basePath}/billing`}
                className="text-sm rounded-full px-4 py-2 font-medium"
                style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
              >
                Manage wallet →
              </Link>
              {topupMsg && <span className="text-xs ml-2 self-center" style={{ color: THEME.ink3 }}>{topupMsg}</span>}
            </div>
          </div>
        </div>
      )}

      {renewalSoon && (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
          <RefreshCw size={20} style={{ color: THEME.black, flexShrink: 0 }} />
          <div className="flex-1">
            <div className="font-semibold" style={{ color: THEME.black }}>
              {daysUntilRenewal <= 0 ? 'Plan renewal is due' : `Plan renews in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? '' : 's'}`}
            </div>
            <p className="text-sm mt-1" style={{ color: THEME.black }}>
              Your {displayNumbers[0]?.plan?.label || 'current'} plan renews on {fmtDate(nextRenewal)}. Upgrade now to keep your availability steady.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={`${basePath}/billing?tab=plans`}
                className="text-sm inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-medium"
                style={{ backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` }}
              >
                <TrendingUp size={14} /> Upgrade plan
              </Link>
              <Link
                to={`${basePath}/billing`}
                className="text-sm rounded-full px-4 py-2 font-medium"
                style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
              >
                Manage plan →
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-[28px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Account overview</div>
            <h2 className="mt-2 font-display text-2xl font-semibold" style={{ color: THEME.black }}>Good morning, {currentUser?.name || 'Demo User'}</h2>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: THEME.muted }}>
              Your voice agent is active and your numbers are performing well. This snapshot highlights minute balance, recent activity, and the next best action.
            </p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Primary number</div>
            <div className="mt-1 font-semibold" style={{ color: THEME.black }}>{testNumber || currentUser?.number?.value || '—'}</div>
            <div className="mt-1 text-sm" style={{ color: '#586379' }}>{currentUser?.plan?.label || 'Demo Plan'}</div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Minutes left" value={`${minLeft.toFixed(0)} min`} note={`${minTotal.toFixed(0)} available`} />
          <MetricCard label="Calls today" value={displayStats?.callsToday ?? 12} note="Live activity" />
          <MetricCard label="Monthly minutes" value={fmtDuration((displayStats?.minutesUsedThisMonth || 340) * 60)} note="This month" />
          <MetricCard label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '94%'} note="Last 30 days" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Minutes & plan</div>
              <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Your current plan balance</h3>
            </div>
            <Link to={`${basePath}/billing`} className="text-sm font-medium hover:underline" style={{ color: THEME.orange }}>Manage plan</Link>
          </div>

          <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
            <div className="flex items-center justify-between text-sm" style={{ color: THEME.muted }}>
              <span>Included minutes</span>
              <span className="font-semibold" style={{ color: THEME.black }}>{planMin.toFixed(0)} min</span>
            </div>
            <div className="mt-3 h-2 rounded-full" style={{ backgroundColor: THEME.softStrong }}>
              <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (minLeft / Math.max(1, minTotal)) * 100)}%`, backgroundColor: THEME.orange }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm" style={{ color: THEME.muted }}>
              <span>{minLeft.toFixed(0)} minutes remaining</span>
              <span>{minUsedAllTime.toFixed(0)} used so far</span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Wallet balance</div>
              <div className="mt-2 text-xl font-semibold" style={{ color: THEME.black }}>{walletMin.toFixed(0)} min</div>
              <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{wallet?.walletUsd ?? currentUser?.walletUsd ?? 240} USD available</div>
            </div>
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Auto top-up</div>
              <div className="mt-2 text-xl font-semibold" style={{ color: THEME.black }}>{autoTopupOn ? 'Enabled' : 'Off'}</div>
              <div className="mt-1 text-sm" style={{ color: THEME.muted }}>Keep service running without interruptions</div>
            </div>
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Plan renews</div>
              <div className="mt-2 text-xl font-semibold" style={{ color: THEME.black }}>{fmtDate(nextRenewal) !== '—' ? fmtDate(nextRenewal) : '18 Sep'}</div>
              <div className="mt-1 text-sm" style={{ color: THEME.muted }}>Next billing cycle</div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Plan details</div>
            <div className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-4">
              <div>
                <div className="text-[11px]" style={{ color: '#586379' }}>Plan name</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>{currentUser?.plan?.label || 'Growth Plan'}</div>
              </div>
              <div>
                <div className="text-[11px]" style={{ color: '#586379' }}>Billing cycle</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>Monthly</div>
              </div>
              <div>
                <div className="text-[11px]" style={{ color: '#586379' }}>Cost per minute</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>$0.09</div>
              </div>
              <div>
                <div className="text-[11px]" style={{ color: '#586379' }}>Rollover minutes</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: THEME.black }}>45 min</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
              <div className="text-lg font-semibold" style={{ color: THEME.black }}>62 min</div>
              <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Used this week</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
              <div className="text-lg font-semibold" style={{ color: THEME.black }}>11 min</div>
              <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Used yesterday</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
              <div className="text-lg font-semibold" style={{ color: THEME.black }}>3.4 min</div>
              <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Avg call length</div>
            </div>
            <div className="rounded-xl p-3 text-center" style={{ border: `1px solid ${THEME.orangeBorder}` }}>
              <div className="text-lg font-semibold" style={{ color: THEME.black }}>$30.60</div>
              <div className="text-[11px] mt-1" style={{ color: '#586379' }}>Est. cost this month</div>
            </div>
          </div>

          {/* Minutes usage trend — dummy 6-month history rendered as an
              inline SVG area chart so it needs no external chart library. */}
          <div className="mt-5 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>Minutes usage · last 6 months</div>
              <div className="text-[11px] font-medium" style={{ color: THEME.orange }}>+18% vs prior period</div>
            </div>
            <svg viewBox="0 0 560 160" className="mt-3 w-full" style={{ height: 140 }}>
              <defs>
                <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={THEME.orange} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={THEME.orange} stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* gridlines */}
              {[20, 58, 96, 134].map((y) => (
                <line key={y} x1="20" y1={y} x2="540" y2={y} stroke={THEME.softStrong} strokeWidth="1" />
              ))}
              {/* filled area under the trend line */}
              <path d="M20,82 L120,71 L220,88 L320,52 L420,63 L520,39 L520,140 L20,140 Z" fill="url(#usageFill)" />
              {/* trend line */}
              <path d="M20,82 L120,71 L220,88 L320,52 L420,63 L520,39" fill="none" stroke={THEME.orange} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {/* data points */}
              {[[20, 82], [120, 71], [220, 88], [320, 52], [420, 63], [520, 39]].map(([x, y]) => (
                <circle key={x} cx={x} cy={y} r="4" fill={THEME.white} stroke={THEME.orange} strokeWidth="2.5" />
              ))}
              {/* month labels */}
              {['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((label, i) => (
                <text key={label} x={20 + i * 100} y="155" textAnchor="middle" fontSize="10" fill={THEME.muted}>{label}</text>
              ))}
            </svg>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Quick actions</div>
                <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Keep the experience moving</h3>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <Link to={`${basePath}/agents`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}>Edit agent</Link>
              <Link to={`${basePath}/billing`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.orange, color: THEME.white, border: `1px solid ${THEME.orange}` }}>Buy more minutes</Link>
              <Link to={`${basePath}/analytics`} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}>View analytics</Link>
            </div>
          </div>

          <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Recent activity</div>
            <div className="mt-4 space-y-3">
              {activityFeed.map((item) => (
                <div key={item.title} className="rounded-2xl p-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium" style={{ color: THEME.black }}>{item.title}</div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
                      style={stateStyles[item.tone] || stateStyles.black}
                    >
                      {item.state}
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{item.meta}</div>
                  <div className="mt-2 text-xs" style={{ color: '#8a93a6' }}>{item.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Performance</div>
              <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Call volume and sentiment</h3>
            </div>
            <Link to={`${basePath}/analytics`} className="text-sm font-medium hover:underline" style={{ color: THEME.orange }}>View analytics</Link>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Stat label="Calls" value={displayCallStats?.total_calls ?? displayStats?.callsAllTime ?? 218} />
            <Stat label="Answer rate" value={displayCallStats?.answer_rate != null ? `${displayCallStats.answer_rate}%` : '94%'} />
            <Stat label="Avg duration" value={displayCallStats?.avg_duration_seconds != null ? fmtDuration(displayCallStats.avg_duration_seconds) : fmtDuration(displayStats?.avgDurationSec || 154)} />
          </div>

          {displaySentiment && (
            <div className="mt-6 rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold" style={{ color: THEME.black }}>Caller sentiment</div>
                {!!displaySentiment.needFollowUp && (
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ backgroundColor: THEME.softStrong, color: THEME.black, border: `1px solid ${THEME.orangeBorder}` }}>
                    {displaySentiment.needFollowUp} need follow-up
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <div className="text-3xl font-semibold" style={{ color: THEME.black }}>{displaySentiment.sentiment_percentages?.positive ?? 0}%</div>
                <div className="text-sm" style={{ color: THEME.muted }}>positive</div>
              </div>
              <div className="mt-3 h-2 rounded-full overflow-hidden flex" style={{ backgroundColor: THEME.softStrong }}>
                <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.positive ?? 0}%`, backgroundColor: THEME.orange }} />
                <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.neutral ?? 0}%`, backgroundColor: '#8a93a6' }} />
                <div className="h-2" style={{ width: `${displaySentiment.sentiment_percentages?.negative ?? 0}%`, backgroundColor: THEME.muted }} />
              </div>
            </div>
          )}

          {volumeBars.length > 0 && (
            <div className="mt-6">
              <div className="text-sm font-semibold" style={{ color: THEME.black }}>Call volume · last 7 days</div>
              <div className="mt-4 flex items-end gap-2">
                {volumeBars.map((d) => {
                  const max = Math.max(1, ...volumeBars.map((x) => Number(x.count || x.calls || 0)));
                  const v = Number(d.count || d.calls || 0);
                  const barPx = Math.max(10, Math.round((v / max) * 72));
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full rounded-t-2xl" style={{ height: barPx, backgroundColor: THEME.orange }} />
                      <div className="text-[11px]" style={{ color: '#586379' }}>{new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[24px] p-6 shadow-sm" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.white }}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: THEME.muted }}>Coverage</div>
          <h3 className="mt-1 text-lg font-semibold" style={{ color: THEME.black }}>Your voice setup</h3>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
              <div className="text-sm font-semibold" style={{ color: THEME.black }}>Number ready</div>
              <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{testNumber || currentUser?.number?.value || 'No number configured yet'}</div>
            </div>
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
              <div className="text-sm font-semibold" style={{ color: THEME.black }}>Agent persona</div>
              <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{currentUser?.agentName || 'Demo Agent'}</div>
            </div>
            <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
              <div className="text-sm font-semibold" style={{ color: THEME.black }}>Next action</div>
              <div className="mt-1 text-sm" style={{ color: THEME.black }}>Review your knowledge base and keep the greeting sharp for callers.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: THEME.black }}>{value}</div>
    </div>
  );
}

function MetricCard({ label, value, note }) {
  return (
    <div className="rounded-2xl p-4" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.soft }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: THEME.muted }}>{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: THEME.black }}>{value}</div>
      <div className="mt-1 text-sm" style={{ color: THEME.muted }}>{note}</div>
    </div>
  );
}

function ProvisioningBanner() {
  const { currentUser } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [localStatus, setLocalStatus] = useState(currentUser?.provisioning?.status || 'unprovisioned');
  const [localErr, setLocalErr] = useState(currentUser?.provisioning?.error || null);

  if (!currentUser?.number?.value) return null;

  const status = localStatus;
  const error = localErr;

  const provision = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await api('/api/provision/me', { method: 'POST' });
      setMsg('✓ ' + (r.log || []).join(' · '));
      setLocalStatus('ready');
      setLocalErr(null);
    } catch (e) {
      setMsg('✗ ' + e.message);
      setLocalStatus('failed');
      setLocalErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'ready') return null;

  return (
    <div className="mt-4 rounded-2xl p-4 flex items-start gap-3" style={{ border: `1px solid ${THEME.orangeBorder}`, backgroundColor: THEME.orangeSoft }}>
      <Phone size={22} style={{ color: THEME.black, flexShrink: 0 }} />
      <div className="flex-1">
        <div className="font-semibold" style={{ color: THEME.black }}>
          Inbound calling: {status === 'in_progress' ? 'in progress…' : status === 'failed' ? 'failed' : 'not provisioned yet'}
        </div>
        <p className="text-sm mt-1" style={{ color: THEME.black }}>
          {status === 'failed'
            ? <>Last error: {error || 'unknown'}. Retry to recreate the SIP trunk + dispatch rule + agent on 9278.</>
            : <>Click below to set up your inbound calling, routing, and voice agent.</>
          }
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            className="text-sm rounded-full px-4 py-2 font-medium transition-colors"
            style={{ backgroundColor: THEME.white, color: THEME.orange, border: `1px solid ${THEME.orange}` }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = THEME.orange; e.currentTarget.style.color = THEME.white; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = THEME.white; e.currentTarget.style.color = THEME.orange; }}
            onClick={provision}
            disabled={busy}
          >
            {busy ? 'Provisioning…' : 'Provision inbound now'}
          </button>
          {msg && <span className="text-xs" style={{ color: THEME.ink3 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}