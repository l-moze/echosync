export function OverlayExitConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="overlayExitConfirmScrim" role="presentation">
      <section aria-modal="true" className="overlayExitConfirm" role="dialog" aria-labelledby="overlayExitConfirmTitle">
        <h2 id="overlayExitConfirmTitle">退出同传？</h2>
        <p>将停止当前识别并保存本次字幕记录，之后可在会议记录中查看。</p>
        <div className="overlayExitConfirmActions">
          <button onClick={onCancel} type="button">
            取消
          </button>
          <button className="danger" onClick={onConfirm} type="button">
            退出同传
          </button>
        </div>
      </section>
    </div>
  );
}
