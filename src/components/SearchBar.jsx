import SearchIcon from './SearchIcon.jsx';

export default function SearchBar({ value, onChange }) {
  return (
    <div className="relative max-w-xl">
      <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search by caller, phone, call ID, or agent"
        className="input input-accent pl-10 pr-4"
      />
    </div>
  );
}
