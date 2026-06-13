export function PreferenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="preferenceRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
