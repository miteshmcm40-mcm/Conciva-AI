import { Link } from 'react-router-dom';

// Lightweight footer used on the signin page + below the customer dashboard.
// Brand + legal-entity line on the left, legal links on the right, year
// auto-updates.
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-gradient-to-b from-white/70 to-lime-50/40 dark:from-slate-900/70 dark:to-slate-900/40 backdrop-blur">
      <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <div className="text-slate-500 dark:text-slate-400 tracking-wide">
          © {year} <strong className="text-slate-700 dark:text-slate-200">conciva.ai</strong>
          <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
          operated by{' '}
          <a
            href="https://www.tkos.co.za/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-lime-700 dark:text-lime-500 hover:text-lime-800 dark:hover:text-lime-400 underline decoration-lime-300 dark:decoration-lime-700 underline-offset-2 transition-colors"
          >
            TKOS
          </a>
        </div>
        <nav className="flex items-center gap-4 sm:gap-5">
          <Link to="/terms" className="text-slate-600 dark:text-slate-300 hover:text-lime-700 dark:hover:text-lime-500 underline-offset-4 hover:underline decoration-lime-400 transition-all hover:-translate-y-px">
            Terms &amp; Conditions
          </Link>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <Link to="/privacy" className="text-slate-600 dark:text-slate-300 hover:text-lime-700 dark:hover:text-lime-500 underline-offset-4 hover:underline decoration-lime-400 transition-all hover:-translate-y-px">
            Privacy Policy
          </Link>
          <span className="text-slate-300 dark:text-slate-700">•</span>
          <a
            href="mailto:support@conciva.ai"
            className="text-slate-600 dark:text-slate-300 hover:text-lime-700 dark:hover:text-lime-500 underline-offset-4 hover:underline decoration-lime-400 transition-all hover:-translate-y-px"
          >
            Support
          </a>
        </nav>
      </div>
    </footer>
  );
}