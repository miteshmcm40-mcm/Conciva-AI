import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileBarChart, Users, Globe } from 'lucide-react';

// Sub-components
import FilterBar from '../../components/FilterBar.jsx';
import StatsCards from '../../components/StatsCards.jsx';
import ReportCard from '../../components/ReportCard.jsx';

// Data & Utils
import { mockReportData } from '../../utils/mockReportData.js';
import { mockTranscripts } from '../../utils/mockTranscripts.js';
import { mockSummaries } from '../../utils/mockSummaries.js';
import { exportToCsv } from '../../utils/exportUtils.js';
import { getDateRange } from '../../utils/dateHelpers.js';

const useAnalytics = (records) => {
  return useMemo(() => {
    const total = records.length;
    if (total === 0) return { totalCalls: 0, answeredCalls: 0, missedCalls: 0, avgDuration: '0s', totalMinutes: '0', positiveCalls: 0, negativeCalls: 0, topAgent: 'N/A' };

    const stats = records.reduce((acc, r) => {
      acc.durationSum += (r.duration || 0);
      if (r.status === 'Completed') acc.answered++;
      if (r.status === 'Missed') acc.missed++;
      if (r.sentiment === 'Positive') acc.positive++;
      acc.agentScores[r.agentName] = (acc.agentScores[r.agentName] || 0) + (r.sentiment === 'Positive' ? 1 : 0);
      return acc;
    }, { durationSum: 0, answered: 0, missed: 0, positive: 0, negative: 0, agentScores: {} });

    const avgSecs = Math.round(stats.durationSum / total);
    const topAgent = Object.entries(stats.agentScores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return {
      totalCalls: total,
      answeredCalls: stats.answered,
      missedCalls: stats.missed,
      avgDuration: `${Math.floor(avgSecs / 60)}m ${avgSecs % 60}s`,
      totalMinutes: `${Math.round(stats.durationSum / 60)}`,
      positiveCalls: stats.positive,
      topAgent
    };
  }, [records]);
};

export default function PremiumReports() {
  const [filters, setFilters] = useState({
    preset: 'last7',
    ...getDateRange('last7'),
    status: 'all',
    language: 'all',
    agent: 'all',
    search: '',
  });

  const metadata = useMemo(() => ({
    agents: Array.from(new Set(mockReportData.map(r => r.agentName))),
    languages: Array.from(new Set(mockReportData.map(r => r.language))),
    statuses: Array.from(new Set(mockReportData.map(r => r.status)))
  }), []);

  const filteredRecords = useMemo(() => {
    const fromTs = new Date(`${filters.from}T00:00:00`).getTime();
    const toTs = new Date(`${filters.to}T23:59:59`).getTime();
    const search = filters.search.toLowerCase().trim();

    return mockReportData.filter((r) => {
      const rTs = new Date(`${r.callDate}T00:00:00`).getTime();
      if (rTs < fromTs || rTs > toTs) return false;
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.language !== 'all' && r.language !== filters.language) return false;
      if (filters.agent !== 'all' && r.agentName !== filters.agent) return false;
      if (search) {
        return [r.callId, r.callerName, r.callerNumber, r.agentName]
          .some(val => String(val).toLowerCase().includes(search));
      }
      return true;
    });
  }, [filters]);

  const stats = useAnalytics(filteredRecords);

  const handlePresetChange = useCallback((preset) => {
    setFilters(prev => ({ ...prev, preset, ...getDateRange(preset) }));
  }, []);

  const handleExport = () => {
    const config = [{ label: 'Call ID', key: 'callId' }, { label: 'Date', key: 'callDate' }];
    exportToCsv(filteredRecords, config, `voice-report-${filters.preset}`);
  };

  return (
    /** 
     * FIX 1: Ensure the container has overflow-y-auto and min-h-screen 
     * This prevents the "not moving up" issue if a parent has overflow: hidden.
     */
    <div className="relative min-h-screen w-full overflow-y-auto bg-slate-50 p-4 pb-32 lg:p-8">
      <div className="mx-auto max-w-[1440px] space-y-10">
        
        {/* 
          FIX 2: Ensure FilterBar is not sticky if it's too tall.
          We also wrap it in a div with a shadow for better separation.
        */}
        <section className="relative rounded-[32px] border border-orange-100 bg-white p-2 shadow-sm">
          <FilterBar
            values={filters}
            onPresetChange={handlePresetChange}
            onDateChange={(field, val) => setFilters(p => ({ ...p, [field]: val }))}
            onSearchChange={(val) => setFilters(p => ({ ...p, search: val }))}
            onFieldChange={(field, val) => setFilters(p => ({ ...p, [field]: val }))}
            onExport={handleExport}
            {...metadata}
          />
        </section>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <StatsCards data={stats} />
        </motion.div>

        <motion.div
          className="grid gap-6 lg:grid-cols-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:col-span-2">
            <InsightCard 
              title="Top Performing Agent" 
              value={stats.topAgent} 
              desc="Based on positive sentiment"
              icon={<Users className="text-emerald-500" size={20} />}
            />
            <InsightCard 
              title="Primary Language" 
              value={metadata.languages[0] || 'English'} 
              desc="Most frequent language"
              icon={<Globe className="text-blue-500" size={20} />}
            />
          </div>

          <div className="flex flex-col justify-between rounded-[32px] border border-orange-100 bg-gradient-to-br from-white to-orange-50/40 p-6 shadow-sm transition-all hover:shadow-lg hover:border-orange-200">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Actions</span>
              <h3 className="mt-2 text-lg font-bold text-slate-900">Export Reports</h3>
              <p className="mt-1 text-xs text-slate-500">Download CSV for the filtered view.</p>
            </div>
            <button
              onClick={handleExport}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition-all hover:bg-orange-600 hover:shadow-[0_8px_20px_-8px_rgba(249,115,22,0.6)] hover:-translate-y-0.5 active:scale-95"
            >
              <Download size={16} /> Export {filteredRecords.length} Records
            </button>
          </div>
        </motion.div>

        {/* 
          FIX 3: Data Section
          Heading is clearly separated so user knows data starts here.
        */}
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <h2 className="text-2xl font-black tracking-tight text-slate-900">Call Logs</h2>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-sm font-bold text-slate-500">{filteredRecords.length} Interactions</span>
            </div>
          </div>

          <div className="grid gap-6">
            <AnimatePresence mode="popLayout">
              {filteredRecords.length > 0 ? (
                filteredRecords.map((record) => (
                  <motion.div
                    key={record.callId}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <ReportCard
                      record={record}
                      transcript={mockTranscripts[record.callId]}
                      summary={mockSummaries[record.callId]}
                    />
                  </motion.div>
                ))
              ) : (
                <EmptyState />
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </div>
  );
}

// --- Internal Helper Components ---
const InsightCard = ({ title, value, desc, icon }) => (
  <div className="rounded-[32px] border border-orange-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-orange-200">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-50">{icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</span>
    </div>
    <div className="mt-4">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
    </div>
  </div>
);

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center rounded-[40px] border-2 border-dashed border-slate-200 py-20 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
      <FileBarChart size={32} />
    </div>
    <h3 className="mt-4 text-lg font-bold text-slate-900">No records found</h3>
    <p className="text-sm text-slate-500">Try adjusting your filters.</p>
  </div>
);