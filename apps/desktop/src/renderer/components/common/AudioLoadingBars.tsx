export function AudioLoadingBars({ active }: { active: boolean }) {
  return (
    <div className={active ? "audioLoadingBars active" : "audioLoadingBars"} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
