export default function ExportButton({ onExport, disabled }) {
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled}
      className="rounded-full border border-[#3a5a0c] bg-[#ecf3df] px-4 py-2 text-sm font-semibold text-[#3a5a0c] transition hover:bg-[#d8e6bf] disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export CSV
    </button>
  );
}
