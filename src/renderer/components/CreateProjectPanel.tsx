import type { ProjectInput } from "@shared/types";
import visualStyleGridImage from "../../assets/visual-styles/style-grid.png";

const promptLanguageOptions = ["English", "Vietnamese"] as const;
const aspectRatioPresets = [
  { value: "16:9", width: 16, height: 9 },
  { value: "9:16", width: 9, height: 16 },
  { value: "1:1", width: 1, height: 1 },
  { value: "4:3", width: 4, height: 3 },
  { value: "3:4", width: 3, height: 4 },
  { value: "21:9", width: 21, height: 9 },
] as const;
const visualStyleOptions = [
  "Pixar 3D",
  "Studio Ghibli",
  "Claymation",
  "Disney 2D",
  "Stick Figure",
  "Watercolor",
  "Ink Sketch",
  "Low Poly 3D",
  "Voxel / Pixel 3D",
  "Retro Pixel Art (2D)",
  "Comic Book",
  "Flat Design / Vector",
  "Line Art",
  "Chibi",
  "Realistic Photo",
] as const;
const visualStylePreviewPositions: Record<
  (typeof visualStyleOptions)[number],
  string
> = {
  "Pixar 3D": "1.5% 0%",
  "Studio Ghibli": "25.5% 0.5%",
  Claymation: "50.5% 0%",
  "Disney 2D": "74.5% 0%",
  "Stick Figure": "99.5% 1%",
  Watercolor: "1% 49%",
  "Ink Sketch": "25.5% 50%",
  "Low Poly 3D": "50.5% 49.5%",
  "Voxel / Pixel 3D": "74.5% 50.5%",
  "Retro Pixel Art (2D)": "99% 50.5%",
  "Comic Book": "0.5% 100%",
  "Flat Design / Vector": "25.5% 100%",
  "Line Art": "50% 100%",
  Chibi: "74.5% 100%",
  "Realistic Photo": "99% 100%",
};

export function CreateProjectPanel(props: {
  locale: "en" | "vi";
  projectForm: ProjectInput;
  setProjectForm: (next: ProjectInput) => void;
  busy: boolean;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);

  return (
    <section className="create-project-view panel">
      <div className="section-head">
        <h2>{t("Create Project", "Tạo dự án")}</h2>
        <span className="pill">{t("Step 1 Setup", "Thiết lập Bước 1")}</span>
      </div>
      <label>
        {t("Title", "Tiêu đề")}
        <input
          value={props.projectForm.title}
          onChange={(event) =>
            props.setProjectForm({
              ...props.projectForm,
              title: event.target.value,
            })
          }
        />
      </label>
      <label>
        {t("Content (ORIGINAL_CONTENT)", "Nội dung (ORIGINAL_CONTENT)")}
        <textarea
          value={props.projectForm.originalContent}
          rows={8}
          onChange={(event) =>
            props.setProjectForm({
              ...props.projectForm,
              originalContent: event.target.value,
            })
          }
        />
      </label>
      <div className="two-col">
        <label>
          {t("Prompt Language", "Ngôn ngữ prompt")}
          <select
            value={props.projectForm.promptLanguage}
            onChange={(event) =>
              props.setProjectForm({
                ...props.projectForm,
                promptLanguage: event.target.value as ProjectInput["promptLanguage"],
              })
            }
          >
            {promptLanguageOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Story Language", "Ngôn ngữ câu chuyện")}
          <select
            value={props.projectForm.transcriptLanguagePolicy}
            onChange={(event) =>
              props.setProjectForm({
                ...props.projectForm,
                transcriptLanguagePolicy:
                  event.target.value as ProjectInput["transcriptLanguagePolicy"],
              })
            }
          >
            {promptLanguageOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t("Size / Aspect Ratio", "Kích thước / Tỷ lệ")}
        <select
          value={props.projectForm.aspectRatio}
          onChange={(event) =>
            props.setProjectForm({
              ...props.projectForm,
              aspectRatio: event.target.value,
            })
          }
        >
          {aspectRatioPresets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.value}
            </option>
          ))}
        </select>
        <div className="aspect-ratio-preview-grid" aria-hidden="true">
          {aspectRatioPresets.map((preset) => {
            const previewMaxWidth = 56;
            const previewMaxHeight = 40;
            const scale = Math.min(
              previewMaxWidth / preset.width,
              previewMaxHeight / preset.height,
            );
            const previewWidth = Math.round(preset.width * scale);
            const previewHeight = Math.round(preset.height * scale);
            return (
              <button
                key={preset.value}
                type="button"
                className={`aspect-ratio-preview${
                  props.projectForm.aspectRatio === preset.value ? " active" : ""
                }`}
                onClick={() =>
                  props.setProjectForm({
                    ...props.projectForm,
                    aspectRatio: preset.value,
                  })
                }
              >
                <span className="aspect-ratio-preview-label">{preset.value}</span>
                <span className="aspect-ratio-preview-box-wrap">
                  <span
                    className="aspect-ratio-preview-box"
                    style={{
                      width: `${previewWidth}px`,
                      height: `${previewHeight}px`,
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </label>
      <div className="visual-style-field">
        <span>{t("Visual Style", "Phong cách hình ảnh")}</span>
        <div className="visual-style-columns">
          <div className="visual-style-left-col">
            <select
              value={props.projectForm.visualStyle}
              onChange={(event) =>
                props.setProjectForm({
                  ...props.projectForm,
                  visualStyle: event.target.value,
                })
              }
            >
              {visualStyleOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label>
              {t("Art Direction Hint", "Gợi ý định hướng nghệ thuật")}
              <textarea
                rows={4}
                value={props.projectForm.artDirectionHint}
                onChange={(event) =>
                  props.setProjectForm({
                    ...props.projectForm,
                    artDirectionHint: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <div className="visual-style-preview" aria-live="polite">
            <div
              role="img"
              aria-label={`${props.projectForm.visualStyle} example`}
              className="visual-style-preview-image"
              style={{
                backgroundImage: `url(${visualStyleGridImage})`,
                backgroundPosition:
                  visualStylePreviewPositions[
                    props.projectForm.visualStyle as (typeof visualStyleOptions)[number]
                  ] ?? "50% 50%",
              }}
            />
            <span className="visual-style-preview-caption">
              {t("Preview", "Xem trước")}: {props.projectForm.visualStyle}
            </span>
          </div>
        </div>
      </div>

      <div className="inline-row create-project-actions">
        <button className="btn" onClick={props.onCancel}>
          {t("Cancel", "Hủy")}
        </button>
        <button
          className="btn btn-primary"
          onClick={props.onCreate}
          disabled={
            props.busy || !props.projectForm.title || !props.projectForm.originalContent
          }
        >
          {t("Create", "Tạo")}
        </button>
      </div>
    </section>
  );
}
