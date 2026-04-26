import type { AssetRecord, Scene } from "@shared/types";
import { HoverCopyTextarea } from "./HoverCopyTextarea";

export function ScenesView(props: {
  scenes: Scene[];
  assetsByEntity: Map<string, AssetRecord[]>;
  generatingSceneIds: Set<string>;
  selectedAssetIds: string[];
  onOpenLightbox: (src: string, alt: string) => void;
  onToggleAsset: (assetId: string) => void;
  onGenerateImage: (scene: Scene) => void;
  onGenerateVideo: (scene: Scene) => void;
  canGenerateImage: boolean;
  canGenerateVideo: boolean;
  onUpdatePrompts: (
    scene: Scene,
    nextTextToImage: string,
    nextImageToVideo: string,
  ) => void;
  onCopyTextPrompt: (scene: Scene, prompt: string) => void;
  onCopyVideoPrompt: (scene: Scene, prompt: string) => void;
  toRenderableSrc: (filePath: string) => string;
  locale: "en" | "vi";
}) {
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  return (
    <div className="entity-grid">
      {props.scenes.map((scene) => {
        const assets = (
          props.assetsByEntity.get(`scene:${scene.id}`) ?? []
        ).filter((asset) => asset.kind === "image");
        const videos = (
          props.assetsByEntity.get(`video:${scene.id}`) ?? []
        ).filter((asset) => asset.kind === "video");
        const textPrompt =
          scene.promptOverrideTextToImage ?? scene.promptTextToImage;
        const videoPrompt =
          scene.promptOverrideImageToVideo ?? scene.promptImageToVideo;

        return (
          <article key={scene.id} className="entity-card panel-subtle">
            <h3>
              {t("Scene", "Cảnh")} {scene.sceneIndex}: {scene.title}
            </h3>
            <div className="scene-layout">
              <div className="scene-preview">
                {assets[0] ? (
                  <label className="media-card">
                    <img
                      src={props.toRenderableSrc(assets[0].filePath)}
                      alt={`Scene ${scene.sceneIndex} generated`}
                      className="media-thumb"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onOpenLightbox(
                          props.toRenderableSrc(assets[0].filePath),
                          `Scene ${scene.sceneIndex} generated`,
                        );
                      }}
                    />
                    <span className="media-meta">
                      <input
                        type="checkbox"
                        checked={props.selectedAssetIds.includes(assets[0].id)}
                        onChange={() => props.onToggleAsset(assets[0].id)}
                      />
                      {t("image", "ảnh")} • {assets[0].model}
                    </span>
                  </label>
                ) : (
                  <div className="scene-placeholder">
                    {t(
                      "No generated scene image yet",
                      "Chưa có ảnh cảnh được tạo",
                    )}
                  </div>
                )}
                {videos[0] && (
                  <label className="media-card">
                    <video
                      src={props.toRenderableSrc(videos[0].filePath)}
                      className="media-thumb"
                      controls
                      preload="metadata"
                    />
                    <span className="media-meta">
                      <input
                        type="checkbox"
                        checked={props.selectedAssetIds.includes(videos[0].id)}
                        onChange={() => props.onToggleAsset(videos[0].id)}
                      />
                      {t("video", "video")} • {videos[0].model}
                    </span>
                  </label>
                )}
              </div>
              <div className="scene-editor">
                <p>{scene.summary}</p>
                <div className="refs-highlight">
                  <strong>{t("Needs refs", "Cần ảnh tham chiếu")}</strong>
                  <div className="refs-list">
                    {scene.requiredCharacterRefs.length > 0 ? (
                      scene.requiredCharacterRefs.map((refName) => (
                        <span
                          key={`${scene.id}-${refName}`}
                          className="ref-chip"
                        >
                          {refName}
                        </span>
                      ))
                    ) : (
                      <span className="ref-chip ref-chip-empty">
                        {t("None", "Không có")}
                      </span>
                    )}
                  </div>
                </div>
                <label>
                  {t("Text to image prompt", "Prompt text to image")}
                  <HoverCopyTextarea
                    rows={4}
                    value={textPrompt}
                    onChange={(nextValue) =>
                      void props.onUpdatePrompts(scene, nextValue, videoPrompt)
                    }
                    onCopy={() => void props.onCopyTextPrompt(scene, textPrompt)}
                  />
                </label>
                <label>
                  {t("Image to video prompt", "Prompt image to video")}
                  <HoverCopyTextarea
                    rows={4}
                    value={videoPrompt}
                    onChange={(nextValue) =>
                      void props.onUpdatePrompts(scene, textPrompt, nextValue)
                    }
                    onCopy={() => void props.onCopyVideoPrompt(scene, videoPrompt)}
                  />
                </label>
                {(props.canGenerateImage || props.canGenerateVideo) && (
                  <div className="inline-row">
                    {props.canGenerateImage && (
                      <button
                        className="btn"
                        onClick={() => void props.onGenerateImage(scene)}
                        disabled={props.generatingSceneIds.has(scene.id)}
                      >
                        {props.generatingSceneIds.has(scene.id)
                          ? t("Generating...", "Đang tạo...")
                          : t("Generate Scene Image", "Tạo ảnh cảnh")}
                      </button>
                    )}
                    {props.canGenerateVideo && (
                      <button
                        className="btn"
                        onClick={() => void props.onGenerateVideo(scene)}
                      >
                        {t("Generate Video", "Tạo video")}
                      </button>
                    )}
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
