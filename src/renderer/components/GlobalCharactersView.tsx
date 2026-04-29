import { useSnackbar } from "notistack";
import { useCallback, useEffect, useState } from "react";
import type { GlobalCharacterGalleryItem } from "@shared/types";

export function GlobalCharactersView(props: {
  locale: "en" | "vi";
  toRenderableSrc: (filePath: string) => string;
  busy: boolean;
  setBusy: (next: boolean) => void;
  electronApi: NonNullable<typeof window.electronApi>;
  onOpenLightbox: (src: string, alt: string) => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  const [items, setItems] = useState<GlobalCharacterGalleryItem[]>([]);

  const load = useCallback(async () => {
    const next = await props.electronApi.globalCharacters.listGallery();
    setItems(next);
  }, [props.electronApi]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload() {
    props.setBusy(true);
    try {
      const added =
        await props.electronApi.globalCharacters.uploadLibraryImage();
      await load();
      if (added) {
        enqueueSnackbar(
          t("Image added to library.", "Đã thêm ảnh vào thư viện."),
          { variant: "success" },
        );
      }
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      props.setBusy(false);
    }
  }

  return (
    <section className="workspace panel global-characters-page">
      <div className="section-head">
        <div>
          <h2>{t("Characters", "Nhân vật")}</h2>
          <p className="muted">
            {t(
              "All character images from every project, plus images you upload here.",
              "Tất cả ảnh nhân vật từ mọi dự án, cùng ảnh bạn tải lên tại đây.",
            )}
          </p>
        </div>
        <div className="inline-row">
          {props.busy && (
            <span className="pill">{t("Working...", "Đang xử lý...")}</span>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={props.busy}
            onClick={() => void handleUpload()}
          >
            {t("+ Upload image", "+ Tải ảnh lên")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={props.busy}
            onClick={() => void load()}
          >
            {t("Refresh", "Làm mới")}
          </button>
        </div>
      </div>

      <p className="muted global-characters-count">
        {items.length} {t("images", "ảnh")}
      </p>

      <div className="global-character-grid">
        {items.map((item) => {
          const caption =
            item.source === "library"
              ? `${t("Upload", "Tải lên")}: ${item.originalFileName}`
              : `${item.projectTitle} · ${item.characterName}`;
          return (
            <article
              key={item.tileId}
              className="global-character-tile panel-subtle"
            >
              <button
                type="button"
                className="global-character-thumb-wrap"
                onClick={() =>
                  props.onOpenLightbox(
                    props.toRenderableSrc(item.filePath),
                    caption,
                  )
                }
              >
                <img
                  src={props.toRenderableSrc(item.filePath)}
                  alt=""
                  className="global-character-thumb"
                />
              </button>
              <div className="global-character-meta">
                <strong className="global-character-title">{caption}</strong>
                <small className="muted">
                  {item.source === "project"
                    ? `${item.provider}/${item.model}`
                    : t("Library", "Thư viện")}
                </small>
              </div>
            </article>
          );
        })}
      </div>

      {items.length === 0 && !props.busy ? (
        <p className="muted">
          {t(
            "No character images yet. Generate some in a project or upload here.",
            "Chưa có ảnh nhân vật. Hãy tạo trong dự án hoặc tải ảnh lên đây.",
          )}
        </p>
      ) : null}
    </section>
  );
}
