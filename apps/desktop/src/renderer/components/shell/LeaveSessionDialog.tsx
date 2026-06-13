import type { NavigationConfirmReason } from "../../types/navigation";

const leaveDialogCopy: Record<Exclude<NavigationConfirmReason, null>, { title: string; detail: string; cancelLabel: string; confirmLabel: string }> = {
  active_session: {
    title: "停止同传并返回首页？",
    detail: "当前会话正在运行，返回首页会停止音频采集和实时字幕。",
    cancelLabel: "继续同传",
    confirmLabel: "停止并返回"
  },
  startup_cancel: {
    title: "取消启动并返回首页？",
    detail: "系统正在准备音频或连接同传服务，取消后会关闭本次启动流程。",
    cancelLabel: "继续等待",
    confirmLabel: "取消启动"
  },
  dirty_export: {
    title: "放弃导出前编辑？",
    detail: "当前复盘文本有未导出的修改，返回首页会丢弃这些编辑。",
    cancelLabel: "继续编辑",
    confirmLabel: "放弃并返回"
  }
};

export function LeaveSessionDialog({
  onCancel,
  onConfirm,
  reason
}: {
  onCancel: () => void;
  onConfirm: () => void;
  reason: Exclude<NavigationConfirmReason, null>;
}) {
  const copy = leaveDialogCopy[reason];
  return (
    <div className="modalScrim" role="presentation">
      <section aria-modal="true" className="confirmDialog" role="dialog">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
        <div className="dialogActions">
          <button className="safeAction" autoFocus onClick={onCancel}>
            {copy.cancelLabel}
          </button>
          <button className="dangerAction" onClick={onConfirm}>
            {copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
