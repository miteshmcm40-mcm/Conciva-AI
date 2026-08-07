import { Link } from 'react-router-dom';
import {
  ArrowRight, Play, Zap, Globe, ShieldCheck, Bot, Phone, Mic,
  Volume2, Check, CalendarCheck,
} from 'lucide-react';
import Logo from '../components/Logo.jsx';

// --- Small shared bits ---------------------------------------------------

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Industries', href: '#industries' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Blog', href: '#blog' },
  { label: 'FAQ', href: '#faq' },
];

const Badge = ({ children, dot }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />}
    {children}
  </span>
);

const Stat = ({ value, label }) => (
  <div>
    <div className="font-display text-2xl font-extrabold text-orange-500">{value}</div>
    <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
  </div>
);

const Pill = ({ icon: Icon, children }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
    {Icon && <Icon size={12} className="text-orange-500" />}
    {children}
  </span>
);

// --- Hero: live-call demo card -------------------------------------------

function DemoCard() {
  const bars = [6, 12, 20, 14, 24, 10, 18, 8, 16, 22, 12, 6, 14, 20, 10, 8, 18, 12];
  return (
    <div className="relative mx-auto max-w-sm lg:max-w-none">
      {/* Floating "CRM Updated" badge */}
      <div className="absolute -top-4 -left-4 z-10 flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-lg shadow-slate-900/10">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check size={12} strokeWidth={3} />
        </span>
        <span className="text-xs font-semibold text-slate-700">CRM Updated</span>
      </div>

      <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-2xl shadow-slate-900/10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            Agent Session · Live
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">v1</span>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-500">
              <Mic size={18} />
            </span>
            <div>
              <div className="text-sm font-bold text-slate-900">Aria · Sales Agent</div>
              <div className="text-[11px] text-slate-400">EN-US · Neutral audio</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            On call
          </span>
        </div>

        {/* Waveform */}
        <div className="mt-4 flex h-10 items-center gap-[3px] rounded-2xl bg-orange-50/70 px-4">
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-orange-300 to-orange-500"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>

        {/* Transcript */}
        <div className="mt-4 space-y-2.5">
          <div className="rounded-2xl rounded-bl-sm bg-slate-50 px-3.5 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Caller · 00:14</div>
            <p className="mt-1 text-sm text-slate-700">"Hi, I'm calling about the listing on Maple Street."</p>
          </div>
          <div className="rounded-2xl rounded-br-sm bg-orange-50 px-3.5 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400">Aria · 00:15 · Generating</div>
            <p className="mt-1 text-sm text-slate-700">"Of course — the 4-bed colonial. Are you looking to schedule a showing this week?"</p>
          </div>
        </div>

        {/* Footer chips */}
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3.5">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ticket</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-700">#0276-483XX</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Sentiment</div>
            <div className="mt-0.5 text-xs font-semibold text-emerald-600">Positive</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Intent</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-700">Book showing</div>
          </div>
        </div>
      </div>

      {/* Floating "Calendar Booked" badge */}
      <div className="absolute -bottom-4 -right-3 z-10 flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-lg shadow-slate-900/10">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-white">
          <CalendarCheck size={13} />
        </span>
        <span className="text-xs font-semibold text-slate-700">Calendar Booked</span>
      </div>
    </div>
  );
}

// --- Feature stack cards ---------------------------------------------------

const STACK = [
  {
    num: '01',
    icon: Bot,
    title: 'AI Voice Bot 2.0',
    desc: 'Conversational AI that handles inbound and outbound calls with human-like precision and real-time sentiment analysis.',
    tag: 'Powered by GPT-4o',
  },
  {
    num: '02',
    icon: Phone,
    title: 'Virtual Phone Numbers',
    desc: 'Instant local and toll-free numbers across 190+ countries. Port your existing numbers in minutes.',
    tag: '190+ Countries',
  },
  {
    num: '03',
    icon: Globe,
    title: 'Global SIP Trunking',
    desc: 'Carrier-grade SIP trunks with automatic failover, built for high-volume enterprise call traffic.',
    tag: '99.99% Uptime',
  },
];

const StackCard = ({ num, icon: Icon, title, desc, tag }) => (
  <div className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-orange-100">
    <div className="flex items-start justify-between">
      <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400">Stack · {num}</span>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
        <Icon size={16} />
      </span>
    </div>
    <h3 className="mt-2 text-base font-bold text-slate-900">{title}</h3>
    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{desc}</p>
    <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-semibold text-emerald-600">
      <Check size={13} strokeWidth={3} />
      {tag}
    </div>
  </div>
);

// --- Page -------------------------------------------------------------

export default function Home() {
  return (
    <div className="min-h-screen bg-[#FBF7F2]">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-orange-100/70 bg-[#FBF7F2]/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Logo size={32} />

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.label} href={l.href} className="transition hover:text-slate-900">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/signin" className="text-sm font-semibold text-slate-700 transition hover:text-slate-900">
              Log In
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 rounded-full bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition hover:-translate-y-0.5 hover:bg-orange-600"
            >
              Get Started <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-7xl items-center gap-16 px-6 pb-20 pt-16 lg:grid-cols-2 lg:pt-24">
        <div>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Badge dot>Live</Badge>
            <Badge>AIVA-2.0</Badge>
            <Badge>
              <Zap size={12} className="text-orange-500" /> Real-time AI · 190+ countries · Enterprise-grade
            </Badge>
          </div>

          <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
            Supercharge your business calls with{' '}
            <span className="text-orange-500">AI-powered voice.</span>
          </h1>

          <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-500">
            Conciva AI gives your team enterprise-grade telephony, intelligent AI voice agents, and real-time analytics — all in one unified platform.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition hover:-translate-y-0.5 hover:bg-orange-600"
            >
              Build your first agent <ArrowRight size={16} />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Play size={14} /> Features
            </a>
          </div>

          <div className="mt-12 flex flex-wrap gap-10">
            <Stat value="0.3s" label="Sub-second latency" />
            <Stat value="99.99%" label="Platform uptime" />
            <Stat value="190+" label="Countries supported" />
          </div>
        </div>

        <DemoCard />
      </section>

      {/* Features */}
      <section id="features" className="mx-auto grid max-w-7xl items-start gap-16 px-6 py-20 lg:grid-cols-2">
        <div>
          <Badge>
            <Zap size={12} className="text-orange-500" /> Platform Features
          </Badge>

          <h2 className="mt-5 font-display text-4xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
            Everything your team needs to communicate{' '}
            <span className="text-orange-500">at scale.</span>
          </h2>

          <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-500">
            From AI-powered voice bots to enterprise SIP trunking, Conciva AI gives your team the complete telephony stack without the complexity.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#pricing"
              className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition hover:-translate-y-0.5 hover:bg-orange-600"
            >
              See the full feature matrix <ArrowRight size={16} />
            </a>
            <a
              href="#demo"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Play size={14} /> Book a demo
            </a>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <Pill icon={Zap}>Sub-second latency</Pill>
            <Pill icon={Globe}>190+ countries</Pill>
            <Pill icon={Phone}>Carrier-grade telephony</Pill>
            <Pill icon={ShieldCheck}>SOC 2 certified</Pill>
            <Pill icon={Volume2}>Unlimited concurrency</Pill>
          </div>
        </div>

        <div className="space-y-4">
          {STACK.map((s) => (
            <StackCard key={s.num} {...s} />
          ))}
        </div>
      </section>
    </div>
  );
}   