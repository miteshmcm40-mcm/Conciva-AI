// Calendar-with-clock glyph for Booking History — plain emoji rendered
// inconsistently across platforms (some showed a boxed placeholder instead
// of a calendar), so this is an inline SVG instead.
//
// The clock face sits on a filled circle that knocks out the calendar grid
// lines behind it — `maskColor` must match whatever the icon is drawn on
// (the sidebar's white background by default; pass the square's own color
// when used on a solid/gradient background, e.g. a colored header badge).
export default function BookingIcon({ className = 'w-4 h-4', maskColor = '#ffffff' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4" width="14" height="16" rx="2" />
      <line x1="3" y1="9" x2="17" y2="9" />
      <line x1="7" y1="2" x2="7" y2="6" />
      <line x1="13" y1="2" x2="13" y2="6" />
      <circle cx="17.5" cy="17.5" r="5.5" fill={maskColor} stroke="none" />
      <circle cx="17.5" cy="17.5" r="5" />
      <line x1="17.5" y1="15" x2="17.5" y2="17.5" />
      <line x1="17.5" y1="17.5" x2="19.3" y2="18.5" />
    </svg>
  );
}
