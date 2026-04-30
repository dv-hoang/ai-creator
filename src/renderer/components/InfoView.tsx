import type { ProjectRecord } from "@shared/types";

export function InfoView(props: {
  project: ProjectRecord;
  locale: "en" | "vi";
}) {
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  const project = props.project;

  return (
    <div className="panel-subtle info-view">
      <h3>{t("Project Info", "Thông tin dự án")}</h3>
      <div className="info-grid">
        <div className="info-row">
          <span>{t("Title", "Tiêu đề")}</span>
          <strong>{project.title}</strong>
        </div>
        <div className="info-row">
          <span>{t("Status", "Trạng thái")}</span>
          <strong>{project.status}</strong>
        </div>
        {project.status === "error" && (
          <div className="info-row">
            <span>{t("Script Error", "Lỗi tạo kịch bản")}</span>
            <strong>{project.statusDetail || "-"}</strong>
          </div>
        )}
        {project.status === "processing" && project.statusDetail && (
          <div className="info-row">
            <span>{t("Progress", "Tiến độ")}</span>
            <strong>{project.statusDetail}</strong>
          </div>
        )}
        <div className="info-row">
          <span>{t("Delivery profile", "Hồ sơ giao hàng")}</span>
          <strong>
            {project.deliveryProfile === "animation_studio"
              ? t("Animation studio", "Phim hoạt hình / studio")
              : t("Short form", "Nội dung ngắn / viral")}
          </strong>
        </div>
        {(project.logline || project.theme) && (
          <>
            <div className="info-row">
              <span>{t("Logline", "Logline")}</span>
              <strong>{project.logline || "-"}</strong>
            </div>
            <div className="info-row">
              <span>{t("Theme", "Chủ đề")}</span>
              <strong>{project.theme || "-"}</strong>
            </div>
          </>
        )}
        <div className="info-row">
          <span>{t("Prompt Language", "Ngôn ngữ prompt")}</span>
          <strong>{project.promptLanguage}</strong>
        </div>
        <div className="info-row">
          <span>{t("Story Language", "Ngôn ngữ câu chuyện")}</span>
          <strong>{project.transcriptLanguagePolicy}</strong>
        </div>
        <div className="info-row">
          <span>{t("Aspect Ratio", "Tỷ lệ khung hình")}</span>
          <strong>{project.aspectRatio}</strong>
        </div>
        <div className="info-row">
          <span>{t("Visual Style", "Phong cách hình ảnh")}</span>
          <strong>{project.visualStyle}</strong>
        </div>
        <div className="info-row">
          <span>{t("Art Direction Hint", "Gợi ý định hướng nghệ thuật")}</span>
          <strong>{project.artDirectionHint || "-"}</strong>
        </div>
        <div className="info-row">
          <span>{t("Created At", "Tạo lúc")}</span>
          <strong>{new Date(project.createdAt).toLocaleString()}</strong>
        </div>
        <div className="info-row">
          <span>{t("Updated At", "Cập nhật lúc")}</span>
          <strong>{new Date(project.updatedAt).toLocaleString()}</strong>
        </div>
      </div>

      <label className="info-content">
        {t("Content", "Nội dung")}
        <textarea readOnly rows={8} value={project.originalContent} />
      </label>
    </div>
  );
}
