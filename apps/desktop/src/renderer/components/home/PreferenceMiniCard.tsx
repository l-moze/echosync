export function PreferenceMiniCard({
  label,
  title,
  values
}: {
  label: string;
  title: string;
  values: string[];
}) {
  return (
    <article className="preferenceMiniCard">
      <span>{label}</span>
      <strong>{title}</strong>
      {values.map((value) => (
        <small key={value}>{value}</small>
      ))}
    </article>
  );
}
