// Conciva AI brand mark — the actual icon artwork (headset + chat bubble +
// voice waveform, orange) supplied as an image, paired with the two-tone
// "Conciva" + "AI" wordmark rendered in code.
//
// `size` accepts 'sm' | 'md' | 'lg' or a literal pixel height for the icon.
// Note: unlike the old hand-drawn SVG version, this is a raster PNG, so the
// `white` prop can no longer recolor the icon itself for dark backgrounds
// (it still recolors the wordmark) — swap in a light-background variant of
// the artwork if a dark-background usage is ever needed.
export default function Logo({ size = 'md', white = false, showWordmark = true }) {
  const h = typeof size === 'number'
    ? size
    : size === 'lg' ? 52 : size === 'sm' ? 30 : 40;

  // conciva-icon.png's real dimensions are 429x413 (width x height) — used to
  // compute an explicit pixel width instead of leaving it to 'auto', so the
  // icon never depends on the browser inferring it from a not-yet-loaded image.
  const iconAspectRatio = 429 / 413;
  const w = Math.round(h * iconAspectRatio);

  const concivaColor = white ? '#ffffff' : 'var(--ink)';
  const aiColor = white ? '#FDBA74' : '#F97316';

  return (
   <div
  className="flex items-center select-none"
  style={{ height: 28 }}
>
  <img
    src="/conciva-icon.png"
    alt="Conciva AI"
   
    style={{
      width: "px",
      height: "90px",
      objectFit: "contain",
      background: "transparent",
      display: "block",
    }}
    draggable={false}
  />
</div>
  );
}