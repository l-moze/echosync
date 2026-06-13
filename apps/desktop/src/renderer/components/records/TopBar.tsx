export function TopBar({
  onBack,
  productName = "EchoSync Review",
  pageTitle = "双语复盘",
  statusTexts = []
}: {
  onBack?: () => void;
  productName?: string;
  pageTitle?: string;
  statusTexts?: string[];
}) {
  return (
    <header className="topBar">
      <div className="topLeft">
        {onBack && (
          <button className="backBtn" onClick={onBack} aria-label="返回">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <div>
          <div className="productKicker">{productName}</div>
          <div className="modeTitle">{pageTitle}</div>
        </div>
      </div>
      {statusTexts.length > 0 && (
        <div className="topActions">
          {statusTexts.map((text, i) => (
            <span key={i} className="status">{text}</span>
          ))}
        </div>
      )}
    </header>
  );
}
