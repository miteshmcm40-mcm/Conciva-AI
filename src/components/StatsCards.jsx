import {
  Phone,
  PhoneCall,
  PhoneMissed,
  Clock3,
  Timer,
  Smile,
  Frown,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

const stats = [
  { key: "totalCalls", label: "Total Calls" },
  { key: "answeredCalls", label: "Answered Calls" },
  { key: "missedCalls", label: "Missed Calls" },
  { key: "avgDuration", label: "Avg Duration" },
  { key: "totalMinutes", label: "Total Minutes" },
  { key: "positiveCalls", label: "Positive Calls" },
  { key: "negativeCalls", label: "Negative Calls" },
];

const cardConfig = {
  totalCalls: {
    icon: Phone,
    color: "from-orange-500 to-amber-400",
    iconBg: "bg-orange-100",
    iconColor: "text-orange-600",
    glow: "rgba(249,115,22,0.35)",
    trend: "+12%",
    progress: 92,
  },

  answeredCalls: {
    icon: PhoneCall,
    color: "from-emerald-500 to-green-400",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    glow: "rgba(16,185,129,0.35)",
    trend: "+8%",
    progress: 87,
  },

  missedCalls: {
    icon: PhoneMissed,
    color: "from-red-500 to-rose-400",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    glow: "rgba(239,68,68,0.35)",
    trend: "-4%",
    progress: 28,
  },

  avgDuration: {
    icon: Clock3,
    color: "from-blue-500 to-cyan-400",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    glow: "rgba(59,130,246,0.35)",
    trend: "+6%",
    progress: 74,
  },

  totalMinutes: {
    icon: Timer,
    color: "from-violet-500 to-purple-400",
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    glow: "rgba(139,92,246,0.35)",
    trend: "+15%",
    progress: 90,
  },

  positiveCalls: {
    icon: Smile,
    color: "from-lime-500 to-green-400",
    iconBg: "bg-lime-100",
    iconColor: "text-lime-600",
    glow: "rgba(132,204,22,0.35)",
    trend: "+18%",
    progress: 94,
  },

  negativeCalls: {
    icon: Frown,
    color: "from-pink-500 to-rose-500",
    iconBg: "bg-pink-100",
    iconColor: "text-pink-600",
    glow: "rgba(236,72,153,0.35)",
    trend: "-2%",
    progress: 21,
  },
};

// Whether a decrease in this metric is actually good news (fewer missed /
// negative calls is an improvement, even though the trend number is
// negative) — flips the badge color and arrow direction accordingly instead
// of always showing a green up-arrow regardless of what the number means.
const LOWER_IS_BETTER = new Set(["missedCalls", "negativeCalls"]);

export default function StatsCards({ data }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {stats.map((item, index) => {
        const value = data[item.key];
        const card = cardConfig[item.key];
        const Icon = card.icon;

        const trendValue = parseFloat(card.trend);
        const isIncrease = trendValue >= 0;
        const isGood = LOWER_IS_BETTER.has(item.key) ? !isIncrease : isIncrease;
        const TrendIcon = isIncrease ? TrendingUp : TrendingDown;

        return (
          <div
            key={item.key}
            style={{ animationDelay: `${index * 60}ms` }}
            className="animate-fade-up group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-orange-200"
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 16px 32px -16px ${card.glow}`; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ''; }}
          >
            {/* Gradient Top Border */}
            <div
              className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.color}`}
            />

            {/* Background Glow */}
            <div
              className={`absolute -top-8 -right-8 h-20 w-20 rounded-full bg-gradient-to-br ${card.color} opacity-10 blur-2xl transition-opacity duration-300 group-hover:opacity-25`}
            />

            {/* Header */}
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {item.label}
                </p>

                <h2 className="mt-1.5 text-xl font-bold text-slate-900">
                  {value}
                </h2>

                <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${isGood ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <TrendIcon className={`h-3 w-3 ${isGood ? 'text-emerald-600' : 'text-red-600'}`} />
                  <span className={`text-[11px] font-semibold ${isGood ? 'text-emerald-600' : 'text-red-600'}`}>
                    {card.trend}
                  </span>

                  <span className="ml-0.5 text-[10px] text-slate-500">
                    vs last week
                  </span>
                </div>
              </div>

              {/* Icon */}
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.iconBg} transition-all duration-300 group-hover:scale-110 group-hover:rotate-6`}
              >
                <Icon className={`h-4 w-4 ${card.iconColor}`} />
              </div>
            </div>

            {/* Progress */}
            <div className="mt-3.5">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-500">
                  Performance
                </span>

                <span className="font-semibold text-slate-700">
                  {card.progress}%
                </span>
              </div>

              <div className="relative h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`relative h-full rounded-full bg-gradient-to-r ${card.color} transition-all duration-700`}
                  style={{ width: `${card.progress}%` }}
                >
                  <div className="absolute inset-0 animate-shimmer-sweep" />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
              <div>
                <p className="text-[9px] uppercase tracking-wider text-slate-400">
                  Last Updated
                </p>

                <p className="mt-0.5 text-xs font-semibold text-slate-700">
                  Just now
                </p>
              </div>

              <div className="flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>

                <span className="text-[11px] font-semibold text-emerald-600">
                  Live
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}