import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppSettings,
  AssetRecord,
  GenerationTask,
  ProviderName,
  TaskModelMapping,
} from "@shared/types";

const providerOptions: { value: ProviderName; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "fal", label: "Flux (fal)" },
];

type Props = {
  locale: "en" | "vi";
  projectId: string;
  settings: AppSettings;
  assets: AssetRecord[];
  electronApi: NonNullable<typeof window.electronApi>;
  busy: boolean;
  setBusy: (next: boolean) => void;
  canGenerateImage: boolean;
  canGenerateVideo: boolean;
  getModelsForTask: (
    task: GenerationTask,
    provider: ProviderName,
  ) => string[];
  onRefreshWorkspace: () => Promise<void>;
  toRenderableSrc: (path: string) => string;
  onOpenLightbox: (src: string, alt: string) => void;
};

export function SoloStudioView(props: Props) {
  const t = (en: string, vi: string) =>
    props.locale === "vi" ? vi : en;

  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [imgProvider, setImgProvider] = useState<ProviderName>(
    props.settings.taskModelMappings.generateImage.provider,
  );
  const [imgModel, setImgModel] = useState(
    props.settings.taskModelMappings.generateImage.model,
  );
  const [vidProvider, setVidProvider] = useState<ProviderName>(
    props.settings.taskModelMappings.generateVideo.provider,
  );
  const [vidModel, setVidModel] = useState(
    props.settings.taskModelMappings.generateVideo.model,
  );
  /** `asset:<id>` or `ref:` + encodeURIComponent(absolutePath) */
  const [firstFrameKey, setFirstFrameKey] = useState("");

  const imageModels = useMemo(
    () => props.getModelsForTask("generateImage", imgProvider),
    [props, imgProvider],
  );
  const videoModels = useMemo(
    () => props.getModelsForTask("generateVideo", vidProvider),
    [props, vidProvider],
  );

  useEffect(() => {
    if (imageModels.length > 0 && !imageModels.includes(imgModel)) {
      setImgModel(imageModels[0]!);
    }
  }, [imageModels, imgModel]);

  useEffect(() => {
    if (videoModels.length > 0 && !videoModels.includes(vidModel)) {
      setVidModel(videoModels[0]!);
    }
  }, [videoModels, vidModel]);

  const loadRefs = useCallback(async () => {
    const paths =
      await props.electronApi.solo.listReferenceImages(props.projectId);
    setRefs(paths);
    setSelectedRefs(new Set(paths));
  }, [props.electronApi.solo, props.projectId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  const imageAssets = useMemo(
    () =>
      props.assets.filter(
        (a) => a.kind === "image" && a.projectId === props.projectId,
      ),
    [props.assets, props.projectId],
  );

  const firstFrameOptions = useMemo(() => {
    const fromAssets = imageAssets.map(
      (a) => `asset:${a.id}` as const,
    );
    const fromRefs = refs.map(
      (p) => `ref:${encodeURIComponent(p)}` as const,
    );
    return [...fromAssets, ...fromRefs];
  }, [imageAssets, refs]);

  useEffect(() => {
    if (firstFrameOptions.length === 0) {
      setFirstFrameKey("");
      return;
    }
    if (!firstFrameKey || !firstFrameOptions.includes(firstFrameKey)) {
      setFirstFrameKey(firstFrameOptions[0]!);
    }
  }, [firstFrameOptions, firstFrameKey]);

  function taskMapping(provider: ProviderName, model: string): TaskModelMapping {
    return { provider, model };
  }

  const selectedRefPaths = useMemo(
    () => refs.filter((p) => selectedRefs.has(p)),
    [refs, selectedRefs],
  );

  async function onAddRefs() {
    props.setBusy(true);
    try {
      await props.electronApi.solo.addReferenceImages(props.projectId);
      await loadRefs();
    } finally {
      props.setBusy(false);
    }
  }

  async function onRemoveRef(path: string) {
    props.setBusy(true);
    try {
      await props.electronApi.solo.removeReferenceImage(
        props.projectId,
        path,
      );
      await loadRefs();
    } finally {
      props.setBusy(false);
    }
  }

  async function onGenImage() {
    if (!props.canGenerateImage) return;
    props.setBusy(true);
    try {
      await props.electronApi.solo.generateImage({
        projectId: props.projectId,
        prompt,
        referencePaths: selectedRefPaths,
        taskMapping: taskMapping(imgProvider, imgModel),
      });
      await props.onRefreshWorkspace();
    } finally {
      props.setBusy(false);
    }
  }

  async function onGenVideo() {
    if (!props.canGenerateVideo || !firstFrameKey) return;
    props.setBusy(true);
    try {
      if (firstFrameKey.startsWith("asset:")) {
        await props.electronApi.solo.generateVideo({
          projectId: props.projectId,
          prompt,
          firstFrameAssetId: firstFrameKey.slice("asset:".length),
          referenceImagePaths: selectedRefPaths,
          taskMapping: taskMapping(vidProvider, vidModel),
        });
      } else if (firstFrameKey.startsWith("ref:")) {
        const path = decodeURIComponent(
          firstFrameKey.slice("ref:".length),
        );
        await props.electronApi.solo.generateVideo({
          projectId: props.projectId,
          prompt,
          firstFrameReferencePath: path,
          referenceImagePaths: selectedRefPaths,
          taskMapping: taskMapping(vidProvider, vidModel),
        });
      } else {
        return;
      }
      await props.onRefreshWorkspace();
    } finally {
      props.setBusy(false);
    }
  }

  return (
    <div className="solo-studio panel nested-panel">
      <p className="muted">
        {t(
          "Write your own prompt. Reference images are optional and are sent to providers that support them (e.g. fal). Project style hints are appended automatically.",
          "Tự viết prompt. Ảnh tham chiếu là tùy chọn và được gửi tới provider hỗ trợ (ví dụ fal). Gợi ý phong cách dự án được thêm tự động.",
        )}
      </p>

      <label>
        {t("Prompt", "Prompt")}
        <textarea
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            "Describe the image or motion you want…",
            "Mô tả hình ảnh hoặc chuyển động bạn muốn…",
          )}
        />
      </label>

      <section className="solo-studio-section">
        <h3>{t("Reference images", "Ảnh tham chiếu")}</h3>
        <div className="inline-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onAddRefs()}
            disabled={props.busy}
          >
            {t("Upload images…", "Tải ảnh lên…")}
          </button>
          <span className="muted">
            {t(
              "Select which files to pass into the next generation.",
              "Chọn file để dùng cho lần tạo tiếp theo.",
            )}
          </span>
        </div>
        {refs.length === 0 ? (
          <p className="muted">
            {t("No reference images yet.", "Chưa có ảnh tham chiếu.")}
          </p>
        ) : (
          <ul className="solo-ref-list">
            {refs.map((path) => (
              <li key={path} className="solo-ref-row">
                <label className="solo-ref-check">
                  <input
                    type="checkbox"
                    checked={selectedRefs.has(path)}
                    onChange={(e) => {
                      setSelectedRefs((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) {
                          next.add(path);
                        } else {
                          next.delete(path);
                        }
                        return next;
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="solo-ref-thumb-btn"
                    onClick={() =>
                      props.onOpenLightbox(props.toRenderableSrc(path), "")
                    }
                  >
                    <img
                      src={props.toRenderableSrc(path)}
                      alt=""
                      className="solo-ref-thumb"
                    />
                  </button>
                  <span className="solo-ref-name">{path.split("/").pop()}</span>
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onRemoveRef(path)}
                  disabled={props.busy}
                >
                  {t("Remove", "Xóa")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="solo-studio-section">
        <h3>{t("Generate image", "Tạo ảnh")}</h3>
        <div className="two-col">
          <label>
            {t("Provider", "Provider")}
            <select
              value={imgProvider}
              onChange={(e) =>
                setImgProvider(e.target.value as ProviderName)
              }
            >
              {providerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Model", "Model")}
            <select
              value={imgModel}
              onChange={(e) => setImgModel(e.target.value)}
            >
              {imageModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onGenImage()}
          disabled={
            props.busy ||
            !prompt.trim() ||
            !props.canGenerateImage ||
            imageModels.length === 0
          }
        >
          {t("Generate image", "Tạo ảnh")}
        </button>
      </section>

      <section className="solo-studio-section">
        <h3>{t("Generate video", "Tạo video")}</h3>
        <label>
          {t(
            "First frame (generated image or uploaded reference)",
            "Khung hình đầu (ảnh đã tạo hoặc ảnh tải lên)",
          )}
          <select
            value={firstFrameKey}
            onChange={(e) => setFirstFrameKey(e.target.value)}
          >
            {firstFrameOptions.length === 0 ? (
              <option value="">
                {t(
                  "Generate an image or upload a reference.",
                  "Tạo ảnh hoặc tải ảnh tham chiếu.",
                )}
              </option>
            ) : (
              <>
                {imageAssets.map((a) => (
                  <option key={`a-${a.id}`} value={`asset:${a.id}`}>
                    {t("Generated", "Đã tạo")}: {a.id.slice(0, 8)}… •{" "}
                    {a.model}
                  </option>
                ))}
                {refs.map((p) => (
                  <option key={`r-${p}`} value={`ref:${encodeURIComponent(p)}`}>
                    {t("Upload", "Tải lên")}: {p.split("/").pop()}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
        <div className="two-col">
          <label>
            {t("Provider", "Provider")}
            <select
              value={vidProvider}
              onChange={(e) =>
                setVidProvider(e.target.value as ProviderName)
              }
            >
              {providerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Model", "Model")}
            <select
              value={vidModel}
              onChange={(e) => setVidModel(e.target.value)}
            >
              {videoModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void onGenVideo()}
          disabled={
            props.busy ||
            !prompt.trim() ||
            !props.canGenerateVideo ||
            !firstFrameKey ||
            videoModels.length === 0
          }
        >
          {t("Generate video", "Tạo video")}
        </button>
      </section>
    </div>
  );
}
