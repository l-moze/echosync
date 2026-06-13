import {
  type SubtitleDisplayMode,
  type SubtitleOutlineStyle,
  type SubtitleStyleState
} from "../../../shared/subtitle-style-state";
import { ToolbarIcon } from "../common/ToolbarIcon";
import { StyleSection } from "../settings/StyleSection";
import { fontOptions } from "../../constants/ui";
import { recenterOverlay, setOverlayLocked, setOverlayPinned } from "../../services/ipc/subtitle-style";
import { styleOptionLabel } from "../../utils/labels";

export function SubtitleStylePanel({
  onChange,
  onClose,
  subtitleStyle
}: {
  onChange: (next: Partial<SubtitleStyleState>) => void;
  onClose: () => void;
  subtitleStyle: SubtitleStyleState;
}) {
  return (
    <aside className="subtitleStylePanel" aria-label="字幕样式设置">
      <header className="subtitleStylePanelHandle">
        <div>
          <strong>字幕样式</strong>
          <span>独立窗口</span>
        </div>
        <button title="关闭设置" onClick={onClose}>
          <ToolbarIcon name="close" />
        </button>
      </header>
      <div className="subtitleStylePanelBody">
        <StyleSection title="原文字幕">
          <StepperRow label="字号" max={28} min={12} onChange={(sourceScale) => onChange({ sourceScale })} value={subtitleStyle.sourceScale} />
          <SwatchRow label="颜色" onChange={(sourceColor) => onChange({ sourceColor })} value={subtitleStyle.sourceColor} />
          <SelectRow label="字体" onChange={(sourceFont) => onChange({ sourceFont })} options={fontOptions} value={subtitleStyle.sourceFont} />
          <SwitchRow label="加粗" onChange={(sourceBold) => onChange({ sourceBold })} value={subtitleStyle.sourceBold} />
        </StyleSection>
        <StyleSection title="译文字幕">
          <StepperRow label="字号" max={40} min={20} onChange={(targetScale) => onChange({ targetScale })} value={subtitleStyle.targetScale} />
          <SwatchRow label="颜色" onChange={(targetColor) => onChange({ targetColor })} value={subtitleStyle.targetColor} />
          <SelectRow label="字体" onChange={(targetFont) => onChange({ targetFont })} options={fontOptions} value={subtitleStyle.targetFont} />
          <SwitchRow label="加粗" onChange={(targetBold) => onChange({ targetBold })} value={subtitleStyle.targetBold} />
        </StyleSection>
        <StyleSection title="其他设置">
          <StepperRow label="背景透明度" max={0.95} min={0.35} onChange={(backgroundOpacity) => onChange({ backgroundOpacity })} step={0.05} value={subtitleStyle.backgroundOpacity} />
          <StepperRow label="背景模糊" max={36} min={0} onChange={(backgroundBlur) => onChange({ backgroundBlur })} step={2} value={subtitleStyle.backgroundBlur} />
          <StepperRow label="窗口阴影" max={1} min={0} onChange={(windowShadow) => onChange({ windowShadow })} step={0.05} value={subtitleStyle.windowShadow} />
          <SelectRow
            label="描边样式"
            onChange={(outlineStyle) => onChange({ outlineStyle: outlineStyle as SubtitleOutlineStyle })}
            options={["shadow", "outline", "none"]}
            value={subtitleStyle.outlineStyle}
          />
          <SelectRow
            label="显示模式"
            onChange={(displayMode) => onChange({ displayMode: displayMode as SubtitleDisplayMode })}
            options={["sentencePair", "zonedPair"]}
            value={subtitleStyle.displayMode}
          />
          <ActionRow
            label="窗口位置"
            actions={[
              { label: "锁定位置", onClick: () => void setOverlayPinned(true) },
              { label: "重置位置", onClick: () => void recenterOverlay() }
            ]}
          />
          <ActionRow
            label="鼠标交互"
            actions={[
              { label: "鼠标穿透", onClick: () => void setOverlayLocked(true) },
              { label: "允许点击", onClick: () => void setOverlayLocked(false) }
            ]}
          />
        </StyleSection>
      </div>
    </aside>
  );
}

function StepperRow({
  label,
  max,
  min,
  onChange,
  step = 1,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  const displayValue = step < 1 ? value.toFixed(2) : Math.round(value).toString();
  return (
    <label className="settingRow">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, Number((value - step).toFixed(2))))}>-</button>
        <output>{displayValue}</output>
        <button type="button" onClick={() => onChange(Math.min(max, Number((value + step).toFixed(2))))}>+</button>
      </div>
    </label>
  );
}

function SwitchRow({ label, onChange, value }: { label: string; onChange: (value: boolean) => void; value: boolean }) {
  return (
    <label className="settingRow">
      <span>{label}</span>
      <button className={value ? "switchControl on" : "switchControl"} type="button" onClick={() => onChange(!value)} aria-pressed={value}>
        <span />
      </button>
    </label>
  );
}

function SwatchRow({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  const colors = ["#ffffff", "#f8e38c", "#9fe6ff", "#e4e7ee", "#6ff0c4"];
  return (
    <div className="settingRow">
      <span>{label}</span>
      <div className="swatchGroup">
        {colors.map((color) => (
          <button
            aria-label={`选择 ${color}`}
            className={color === value ? "colorSwatch selected" : "colorSwatch"}
            key={color}
            onClick={() => onChange(color)}
            style={{ background: color }}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

function SelectRow({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="settingRow">
      <span>{label}</span>
      <select className="selectValue" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {styleOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionRow({
  actions,
  label
}: {
  actions: Array<{ label: string; onClick: () => void }>;
  label: string;
}) {
  return (
    <div className="settingRow actionSettingRow">
      <span>{label}</span>
      <div>
        {actions.map((action) => (
          <button key={action.label} onClick={action.onClick} type="button">
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
