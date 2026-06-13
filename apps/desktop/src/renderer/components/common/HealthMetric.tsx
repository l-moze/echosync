export function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="healthMetric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
