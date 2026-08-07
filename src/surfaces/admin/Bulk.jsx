export default function Bulk() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Bulk import</h1>
      <p className="text-mute">Onboard many customers at once via CSV.</p>
      <div className="mt-6 form-card max-w-2xl">
        <div className="rounded p-8 text-center text-sm text-mute" style={{ border: '2px dashed #2a2a2a' }}>
          <div className="text-3xl">📁</div>
          <div className="mt-2">Drop CSV or <span className="text-lime-400 cursor-pointer underline">browse</span></div>
          <div className="text-xs mt-1">columns: name, company, email, plan, area_code</div>
        </div>
        <button className="btn-teal mt-4" disabled>Start bulk import</button>
        <p className="text-xs text-mute mt-3">
          Bulk import is not wired yet — endpoint coming. Use the regular signup flow for now.
        </p>
      </div>
    </div>
  );
}
