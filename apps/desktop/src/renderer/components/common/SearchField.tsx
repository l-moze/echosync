export function SearchField({
  value,
  onChange,
  placeholder = "搜索字幕内容…",
  resultCount
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  resultCount?: number;
}) {
  return (
    <label className="searchField">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <path d="M10.8 18.1a7.3 7.3 0 1 1 0-14.6 7.3 7.3 0 0 1 0 14.6zM16.1 16.1L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {resultCount !== undefined && value && (
        <span className="resultCount">{resultCount}处</span>
      )}
    </label>
  );
}
