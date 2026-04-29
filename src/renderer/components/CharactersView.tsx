import { useSnackbar } from "notistack";
import { useState } from "react";
import type {
  AssetRecord,
  Character,
  GlobalCharacterApplySource,
  GlobalCharacterGalleryItem,
} from "@shared/types";
import { HoverCopyTextarea } from "./HoverCopyTextarea";

export function CharactersView(props: {
  characters: Character[];
  assetsByEntity: Map<string, AssetRecord[]>;
  generatingCharacterIds: Set<string>;
  selectedAssetIds: string[];
  onOpenLightbox: (src: string, alt: string) => void;
  onUpdatePrompt: (character: Character, prompt: string) => void;
  onToggleAsset: (assetId: string) => void;
  onGenerateImage: (character: Character) => void;
  canGenerateImage: boolean;
  onCopyPrompt: (character: Character, prompt: string) => void;
  toRenderableSrc: (filePath: string) => string;
  locale: "en" | "vi";
  electronApi: NonNullable<typeof window.electronApi> | null;
  onAfterGlobalMap?: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  const [mapForCharacter, setMapForCharacter] = useState<Character | null>(
    null,
  );
  const [gallery, setGallery] = useState<GlobalCharacterGalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);

  async function openPicker(character: Character) {
    if (!props.electronApi) return;
    setMapForCharacter(character);
    setGalleryLoading(true);
    try {
      const list = await props.electronApi.globalCharacters.listGallery();
      setGallery(list);
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : String(error),
        { variant: "error" },
      );
      setMapForCharacter(null);
    } finally {
      setGalleryLoading(false);
    }
  }

  async function applyMapping(
    character: Character,
    item: GlobalCharacterGalleryItem,
  ) {
    if (!props.electronApi) return;
    const payload: GlobalCharacterApplySource =
      item.source === "project"
        ? { source: "asset", assetId: item.assetId }
        : { source: "library", libraryId: item.libraryId };
    setApplyBusy(true);
    try {
      await props.electronApi.globalCharacters.applyMapping(
        character.id,
        payload,
      );
      enqueueSnackbar(
        t("Character image updated from library.", "Đã cập nhật ảnh từ thư viện."),
        { variant: "success" },
      );
      setMapForCharacter(null);
      props.onAfterGlobalMap?.();
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : String(error),
        { variant: "error" },
      );
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <>
      <div className="entity-grid">
        {props.characters.map((character) => {
          const prompt = character.promptOverride ?? character.promptTextToImage;
          const imageAsset = (
            props.assetsByEntity.get(`character:${character.id}`) ?? []
          ).find((asset) => asset.kind === "image");

          return (
            <article key={character.id} className="entity-card panel-subtle">
              <h3>
                {character.name} {t("Prompt", "Prompt")}
              </h3>
              <div className="character-layout">
                <div className="character-preview">
                  {imageAsset ? (
                    <>
                      <img
                        src={props.toRenderableSrc(imageAsset.filePath)}
                        alt={`${character.name} generated`}
                        className="media-thumb character-thumb"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onOpenLightbox(
                            props.toRenderableSrc(imageAsset.filePath),
                            `${character.name} generated`,
                          );
                        }}
                      />
                      <label className="media-meta">
                        <input
                          type="checkbox"
                          checked={props.selectedAssetIds.includes(
                            imageAsset.id,
                          )}
                          onChange={() => props.onToggleAsset(imageAsset.id)}
                        />
                        {t("image", "ảnh")} • {imageAsset.model}
                      </label>
                    </>
                  ) : (
                    <div className="character-placeholder">
                      {t(
                        "No generated image yet",
                        "Chưa có ảnh được tạo",
                      )}
                    </div>
                  )}
                </div>
                <div className="character-editor">
                  <HoverCopyTextarea
                    rows={6}
                    value={prompt}
                    onChange={(nextValue) =>
                      void props.onUpdatePrompt(character, nextValue)
                    }
                    onCopy={() => void props.onCopyPrompt(character, prompt)}
                    placeholder={t(
                      "Character text-to-image prompt",
                      "Prompt text-to-image của nhân vật",
                    )}
                  />
                  {(props.canGenerateImage || props.electronApi) && (
                    <div className="inline-row character-actions">
                      {props.canGenerateImage && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void props.onGenerateImage(character)}
                          disabled={props.generatingCharacterIds.has(
                            character.id,
                          )}
                        >
                          {props.generatingCharacterIds.has(character.id)
                            ? t("Generating...", "Đang tạo...")
                            : t("Generate Image", "Tạo ảnh")}
                        </button>
                      )}
                      {props.electronApi ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void openPicker(character)}
                          disabled={applyBusy}
                        >
                          {t("Map from library…", "Chọn từ thư viện…")}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {mapForCharacter ? (
        <section
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="char-map-title"
          onClick={() => !applyBusy && setMapForCharacter(null)}
        >
          <div
            className="modal-card panel character-map-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h2 id="char-map-title">
                {t("Map image for", "Gán ảnh cho")}{" "}
                <strong>{mapForCharacter.name}</strong>
              </h2>
              <button
                type="button"
                className="btn"
                disabled={applyBusy}
                onClick={() => setMapForCharacter(null)}
              >
                {t("Close", "Đóng")}
              </button>
            </div>
            <p className="muted">
              {t(
                "Picks a compressed copy into this project and sets it as the character reference.",
                "Tạo bản sao đã nén trong dự án này và đặt làm ảnh tham chiếu nhân vật.",
              )}
            </p>
            {galleryLoading ? (
              <p className="muted">{t("Loading…", "Đang tải…")}</p>
            ) : (
              <div className="character-map-grid">
                {gallery.map((item) => {
                  const caption =
                    item.source === "library"
                      ? `${t("Upload", "Tải lên")}: ${item.originalFileName}`
                      : `${item.projectTitle} · ${item.characterName}`;
                  return (
                    <button
                      key={item.tileId}
                      type="button"
                      className="character-map-tile panel-subtle"
                      disabled={applyBusy}
                      onClick={() =>
                        void applyMapping(mapForCharacter, item)
                      }
                    >
                      <span className="character-map-thumb-wrap">
                        <img
                          src={props.toRenderableSrc(item.filePath)}
                          alt=""
                          className="character-map-thumb"
                        />
                      </span>
                      <span className="character-map-caption">{caption}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!galleryLoading && gallery.length === 0 ? (
              <p className="muted">
                {t(
                  "No images in the global library yet. Open the Characters page to upload or generate some in other projects.",
                  "Chưa có ảnh trong thư viện. Mở trang Nhân vật để tải lên hoặc tạo ảnh ở dự án khác.",
                )}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
