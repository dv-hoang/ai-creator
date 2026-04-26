import type { AssetRecord, Character } from "@shared/types";
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
}) {
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  return (
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
                        checked={props.selectedAssetIds.includes(imageAsset.id)}
                        onChange={() => props.onToggleAsset(imageAsset.id)}
                      />
                      {t("image", "ảnh")} • {imageAsset.model}
                    </label>
                  </>
                ) : (
                  <div className="character-placeholder">
                    {t("No generated image yet", "Chưa có ảnh được tạo")}
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
                {props.canGenerateImage && (
                  <div className="inline-row">
                    <button
                      className="btn"
                      onClick={() => void props.onGenerateImage(character)}
                      disabled={props.generatingCharacterIds.has(character.id)}
                    >
                      {props.generatingCharacterIds.has(character.id)
                        ? t("Generating...", "Đang tạo...")
                        : t("Generate Image", "Tạo ảnh")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
