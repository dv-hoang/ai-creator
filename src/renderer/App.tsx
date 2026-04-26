import { useEffect, useMemo, useState } from "react";
import { useSnackbar } from "notistack";
import type {
  AppSettings,
  AssetRecord,
  Character,
  GenerationTask,
  ProviderName,
  ProjectInput,
  ProjectRecord,
  ProjectWorkspace,
  Scene,
  TaskModelMapping,
  UpdateCheckResult,
} from "@shared/types";
import { CharactersView } from "./components/CharactersView";
import { CreateProjectPanel } from "./components/CreateProjectPanel";
import { InfoView } from "./components/InfoView";
import { ScenesView } from "./components/ScenesView";
import { SettingsPanel } from "./components/SettingsPanel";
import { TranscriptView } from "./components/TranscriptView";

const languageOptions = [
  { label: "English", value: "en" },
  { label: "Vietnamese", value: "vi" },
] as const;

const providerCatalog = [
  { label: "OpenAI", value: "openai" },
  { label: "Gemini", value: "gemini" },
  { label: "Flux", value: "fal" },
  { label: "ElevenLabs", value: "elevenlabs" },
] as const;
const taskSupportedProviders: Record<
  GenerationTask,
  TaskModelMapping["provider"][]
> = {
  generateScript: ["openai", "gemini"],
  generateImage: ["openai", "gemini", "fal"],
  generateVideo: ["openai", "gemini"],
  textToSpeech: ["elevenlabs"],
};

function getCompatibleModelsForTask(
  task: GenerationTask,
  provider: TaskModelMapping["provider"],
  models: string[],
): string[] {
  if (provider === "fal" || provider === "elevenlabs") {
    return models;
  }

  if (provider === "openai") {
    if (task === "generateScript") {
      return models.filter((model) =>
        /^(gpt|o\d|chatgpt|text-)/i.test(model.trim()),
      );
    }
    if (task === "generateImage") {
      return models.filter((model) =>
        /(image|dall|gpt-image)/i.test(model.trim()),
      );
    }
    if (task === "generateVideo") {
      return models.filter((model) => /(veo|video|sora)/i.test(model.trim()));
    }
    return [];
  }

  if (provider === "gemini") {
    if (task === "generateScript") {
      return models.filter((model) => /gemini/i.test(model.trim()));
    }
    if (task === "generateImage") {
      return models.filter((model) => /(image|gemini)/i.test(model.trim()));
    }
    if (task === "generateVideo") {
      return models.filter((model) => /(veo|video)/i.test(model.trim()));
    }
    return [];
  }

  return models;
}

const emptyProjectInput: ProjectInput = {
  title: "",
  originalContent: "",
  promptLanguage: "English",
  transcriptLanguagePolicy: "English",
  aspectRatio: "16:9",
  visualStyle: "Pixar 3D",
  artDirectionHint: "cinematic lighting",
};

function toRenderableSrc(filePath: string): string {
  if (/^(https?:|data:)/i.test(filePath)) {
    return filePath;
  }

  if (/^file:/i.test(filePath)) {
    const diskPath = decodeURIComponent(filePath.replace(/^file:\/\//i, ""));
    return `local-asset://open?path=${encodeURIComponent(diskPath)}`;
  }

  const normalized = filePath.replaceAll("\\", "/");
  const absolutePath = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  return `local-asset://open?path=${encodeURIComponent(absolutePath)}`;
}

export function App() {
  const [electronApi, setElectronApi] = useState<
    typeof window.electronApi | null
  >(window.electronApi ?? null);
  const [activePage, setActivePage] = useState<
    "workspace" | "settings" | "createProject"
  >("workspace");
  const [settingsTab, setSettingsTab] = useState<
    "general" | "providers" | "controls"
  >("general");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [validatedProviderKeys, setValidatedProviderKeys] = useState<
    Partial<Record<ProviderName, string>>
  >({});
  const [selectedTab, setSelectedTab] = useState<
    "Info" | "Characters" | "Scenes" | "Transcript"
  >("Info");
  const [projectForm, setProjectForm] =
    useState<ProjectInput>(emptyProjectInput);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [untimedTranscript, setUntimedTranscript] = useState("");
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [generatingCharacterIds, setGeneratingCharacterIds] = useState<
    Set<string>
  >(() => new Set());
  const [generatingSceneIds, setGeneratingSceneIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(
    null,
  );

  const [latestUpdate, setLatestUpdate] = useState<UpdateCheckResult | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [showUpdateAvailableModal, setShowUpdateAvailableModal] =
    useState(false);
  const [busy, setBusy] = useState(false);
  const [retryingScriptProjectId, setRetryingScriptProjectId] = useState<
    string | null
  >(null);
  const { enqueueSnackbar } = useSnackbar();
  const locale = settings?.language ?? "en";
  const t = (en: string, vi: string) => (locale === "vi" ? vi : en);
  const canGenerateImage = settings?.generationEnabled.generateImage ?? true;
  const canGenerateVideo = settings?.generationEnabled.generateVideo ?? true;
  const elevenLabsKey =
    settings?.providers
      .find((provider) => provider.name === "elevenlabs")
      ?.apiKey?.trim() ?? "";
  const showElevenLabsVoiceSettings =
    Boolean(elevenLabsKey) &&
    validatedProviderKeys.elevenlabs === elevenLabsKey;

  useEffect(() => {
    if (electronApi) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 20;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (window.electronApi) {
        setElectronApi(window.electronApi);
        window.clearInterval(timer);
        return;
      }

      if (attempts >= maxAttempts) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [electronApi]);

  async function refreshProjects() {
    if (!electronApi) return;
    const next = await electronApi.projects.list();
    setProjects(next);
  }

  async function refreshSettings() {
    if (!electronApi) return;
    try {
      const loadedSettings = await electronApi.settings.get();
      setSettings(loadedSettings);
      setValidatedProviderKeys({});
      setSettingsLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load settings.";
      setSettingsLoadError(message);
      enqueueSnackbar(
        locale === "vi"
          ? `Tải cài đặt thất bại: ${message}`
          : `Settings load failed: ${message}`,
        { variant: "error" },
      );
    }
  }

  async function refreshWorkspace(
    projectId: string,
    options?: { resetTab?: boolean },
  ) {
    if (!electronApi) return;
    const next = await electronApi.projects.getWorkspace(projectId);
    setWorkspace(next);
    if (options?.resetTab || next.project.status === "error") {
      setSelectedTab("Info");
    }
    const nextAssets = await electronApi.assets.listByProject(projectId);
    setAssets(nextAssets);
    setSelectedAssetIds([]);
    const transcriptText = await electronApi.transcript.untimedText(projectId);
    setUntimedTranscript(transcriptText);
  }

  useEffect(() => {
    if (!electronApi) {
      return;
    }

    void (async () => {
      await refreshSettings();
      try {
        setAppVersion(await electronApi.app.getVersion());
      } catch {
        /* sidebar still shows latestUpdate.currentVersion after check, if any */
      }
      try {
        const result = await electronApi.settings.checkForUpdates();
        setLatestUpdate(result);
        setAppVersion((prev) => prev || result.currentVersion);
        if (result.hasUpdate) {
          setShowUpdateAvailableModal(true);
        }
      } catch {
        /* sidebar / settings show placeholder until user checks manually */
      }
      try {
        await refreshProjects();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load projects.";
        enqueueSnackbar(
          locale === "vi"
            ? `Tải dự án thất bại: ${message}`
            : `Projects load failed: ${message}`,
          { variant: "error" },
        );
      }
    })();
  }, [electronApi, enqueueSnackbar]);

  useEffect(() => {
    if (!electronApi) {
      return;
    }

    const hasProcessingProject =
      workspace?.project.status === "processing" ||
      projects.some((project) => project.status === "processing");
    if (!hasProcessingProject) {
      return;
    }

    const interval = window.setInterval(() => {
      void (async () => {
        await refreshProjects();
        if (workspace?.project.status === "processing") {
          await refreshWorkspace(workspace.project.id);
        }
      })();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [electronApi, projects, workspace?.project.id, workspace?.project.status]);

  const assetsByEntity = useMemo(() => {
    const map = new Map<string, AssetRecord[]>();
    assets.forEach((asset) => {
      const key = `${asset.entityType}:${asset.entityId}`;
      const existing = map.get(key) ?? [];
      existing.push(asset);
      map.set(key, existing);
    });
    return map;
  }, [assets]);
  const speechAssets = useMemo(() => {
    if (!workspace) return null;
    return [...assets]
      .filter(
        (asset) =>
          asset.entityType === "transcript" &&
          asset.kind === "audio",
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [assets, workspace]);

  async function handleSaveSettings() {
    if (!settings || !electronApi) return;
    setBusy(true);
    try {
      const requestedMappings = settings.taskModelMappings;
      const saved = await electronApi.settings.save(settings);
      setSettings(saved);
      const providerModelSummary = saved.providers
        .map((provider) => {
          const label =
            providerCatalog.find((item) => item.value === provider.name)
              ?.label ?? provider.name;
          const modelCount = saved.providerModels[provider.name]?.length ?? 0;
          return `${label} ${modelCount}`;
        })
        .join(", ");
      enqueueSnackbar(
        locale === "vi"
          ? `Đã lưu cài đặt toàn cục. Mô hình đã tải: ${providerModelSummary || "0"}.`
          : `Global app settings saved. Loaded models: ${providerModelSummary || "0"}.`,
        { variant: "success" },
      );

      const normalizedTasks = (
        [
          "generateScript",
          "generateImage",
          "generateVideo",
          "textToSpeech",
        ] as GenerationTask[]
      ).flatMap((task) => {
        const requested = requestedMappings[task];
        const actual = saved.taskModelMappings[task];
        if (
          requested.provider === actual.provider &&
          requested.model === actual.model
        ) {
          return [];
        }
        return [`${task}: ${actual.provider}/${actual.model || "-"}`];
      });

      if (normalizedTasks.length > 0) {
        const normalizedSummary = normalizedTasks.join(", ");
        enqueueSnackbar(
          locale === "vi"
            ? `Một số mapping không hợp lệ đã được tự động chỉnh: ${normalizedSummary}`
            : `Some invalid mappings were auto-corrected: ${normalizedSummary}`,
          { variant: "warning" },
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTestVoice(sampleTextInput?: string) {
    if (!electronApi || !settings) return;
    setBusy(true);
    try {
      const defaultSampleText =
        locale === "vi"
          ? "Xin chao, day la doan thu giong noi nhanh tu AI Creator."
          : "Hello, this is a quick voice preview from AI Creator.";
      const sampleText = sampleTextInput?.trim() || defaultSampleText;
      const audioDataUrl = await electronApi.settings.testVoice(
        settings,
        sampleText,
      );
      const audio = new window.Audio(audioDataUrl);
      await audio.play();
      enqueueSnackbar(
        t("Playing voice preview.", "Đang phát thử giọng nói."),
        { variant: "success" },
      );
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? error.message
          : t("Voice test failed.", "Thử giọng thất bại."),
        { variant: "error" },
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProject() {
    if (!electronApi) return;
    setBusy(true);
    enqueueSnackbar(t("Creating project...", "Đang tạo dự án..."), {
      variant: "info",
    });
    try {
      const created = await electronApi.projects.create(projectForm);
      setWorkspace(created);
      setSelectedTab("Info");
      setActivePage("workspace");
      setProjectForm(emptyProjectInput);
      await refreshProjects();
      const nextAssets = await electronApi.assets.listByProject(
        created.project.id,
      );
      setAssets(nextAssets);
      enqueueSnackbar(
        t(
          "Project created. Step 1 generation is running in background.",
          "Đã tạo dự án. Bước 1 đang được tạo ở nền.",
        ),
        { variant: "success" },
      );
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error ? error.message : "Failed to create project",
        { variant: "error" },
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryGenerateScript(projectId: string) {
    if (!electronApi) return;
    setRetryingScriptProjectId(projectId);
    try {
      await electronApi.projects.retryGenerateScript(projectId);
      enqueueSnackbar(
        t(
          "Script generation restarted. This may take a minute.",
          "Đã chạy lại tạo kịch bản. Quá trình có thể mất vài phút.",
        ),
        { variant: "success" },
      );
      await refreshProjects();
      if (workspace?.project.id === projectId) {
        await refreshWorkspace(projectId);
      }
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? error.message
          : t(
              "Failed to restart script generation.",
              "Không thể chạy lại tạo kịch bản.",
            ),
        { variant: "error" },
      );
    } finally {
      setRetryingScriptProjectId(null);
    }
  }

  async function handleValidateProvider(
    provider: TaskModelMapping["provider"],
  ) {
    if (!electronApi) return;
    const apiKey =
      settings?.providers
        .find((item) => item.name === provider)
        ?.apiKey?.trim() ?? "";
    const result = await electronApi.settings.validateProvider(
      provider,
      apiKey,
    );
    setValidatedProviderKeys((previous) => {
      const next = { ...previous };
      if (result.ok) {
        next[provider] = apiKey;
      } else {
        delete next[provider];
      }
      return next;
    });
    enqueueSnackbar(result.message, {
      variant: result.ok ? "success" : "error",
    });
  }

  function handleProviderApiKeyChange(provider: ProviderName, apiKey: string) {
    setValidatedProviderKeys((previous) => {
      const validatedKey = previous[provider];
      if (!validatedKey || validatedKey === apiKey) {
        return previous;
      }
      const next = { ...previous };
      delete next[provider];
      return next;
    });
  }

  async function regenerateCharacterImage(character: Character) {
    if (!electronApi) return;
    if (generatingCharacterIds.has(character.id)) return;
    setBusy(true);
    setGeneratingCharacterIds((previous) => {
      const next = new Set(previous);
      next.add(character.id);
      return next;
    });
    try {
      await electronApi.characters.generateImage(character.id);
      if (workspace) await refreshWorkspace(workspace.project.id);
      enqueueSnackbar(
        locale === "vi"
          ? `Đã tạo ảnh cho ${character.name}`
          : `Generated image for ${character.name}`,
        { variant: "success" },
      );
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? locale === "vi"
            ? `Tạo ảnh cho ${character.name} thất bại: ${error.message}`
            : `Failed to generate image for ${character.name}: ${error.message}`
          : locale === "vi"
            ? `Tạo ảnh cho ${character.name} thất bại`
            : `Failed to generate image for ${character.name}`,
        { variant: "error" },
      );
    } finally {
      setGeneratingCharacterIds((previous) => {
        const next = new Set(previous);
        next.delete(character.id);
        return next;
      });
      setBusy(false);
    }
  }

  async function regenerateSceneImage(scene: Scene) {
    if (!electronApi) return;
    if (generatingSceneIds.has(scene.id)) return;
    setBusy(true);
    setGeneratingSceneIds((previous) => {
      const next = new Set(previous);
      next.add(scene.id);
      return next;
    });
    try {
      await electronApi.scenes.generateImage(scene.id);
      if (workspace) await refreshWorkspace(workspace.project.id);
      enqueueSnackbar(
        locale === "vi"
          ? `Đã tạo ảnh cho cảnh ${scene.sceneIndex}`
          : `Generated image for scene ${scene.sceneIndex}`,
        { variant: "success" },
      );
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? locale === "vi"
            ? `Tạo ảnh cho cảnh ${scene.sceneIndex} thất bại: ${error.message}`
            : `Failed to generate image for scene ${scene.sceneIndex}: ${error.message}`
          : locale === "vi"
            ? `Tạo ảnh cho cảnh ${scene.sceneIndex} thất bại`
            : `Failed to generate image for scene ${scene.sceneIndex}`,
        { variant: "error" },
      );
    } finally {
      setGeneratingSceneIds((previous) => {
        const next = new Set(previous);
        next.delete(scene.id);
        return next;
      });
      setBusy(false);
    }
  }

  async function generateSceneVideo(scene: Scene) {
    if (!electronApi) return;
    const imageAsset = (assetsByEntity.get(`scene:${scene.id}`) ?? []).find(
      (asset) => asset.kind === "image",
    );
    if (!imageAsset) {
      enqueueSnackbar(
        t(
          "Generate or link a scene image before creating a video.",
          "Hãy tạo hoặc liên kết ảnh cảnh trước khi tạo video.",
        ),
        { variant: "warning" },
      );
      return;
    }

    setBusy(true);
    try {
      await electronApi.scenes.generateVideo(scene.id, imageAsset.id);
      if (workspace) await refreshWorkspace(workspace.project.id);
      enqueueSnackbar(
        locale === "vi"
          ? `Đã tạo video cho cảnh ${scene.sceneIndex}`
          : `Generated video for scene ${scene.sceneIndex}`,
        { variant: "success" },
      );
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? locale === "vi"
            ? `Tạo video cho cảnh ${scene.sceneIndex} thất bại: ${error.message}`
            : `Failed to generate video for scene ${scene.sceneIndex}: ${error.message}`
          : locale === "vi"
            ? `Tạo video cho cảnh ${scene.sceneIndex} thất bại`
            : `Failed to generate video for scene ${scene.sceneIndex}`,
        { variant: "error" },
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateCharacterPrompt(character: Character, prompt: string) {
    if (!electronApi) return;
    await electronApi.characters.updatePrompt(character.id, prompt);
    if (workspace) await refreshWorkspace(workspace.project.id);
  }

  async function updateScenePrompts(
    scene: Scene,
    nextTextToImage: string,
    nextImageToVideo: string,
  ) {
    if (!electronApi) return;
    await electronApi.scenes.updatePrompts(scene.id, {
      textToImage: nextTextToImage,
      imageToVideo: nextImageToVideo,
    });
    if (workspace) await refreshWorkspace(workspace.project.id);
  }

  async function downloadSelected() {
    if (!electronApi || !workspace || selectedAssetIds.length === 0) return;
    const location = await electronApi.assets.download(
      workspace.project.id,
      selectedAssetIds,
    );
    if (!location) {
      enqueueSnackbar(t("Download cancelled.", "Đã hủy tải xuống."), {
        variant: "info",
      });
      return;
    }
    enqueueSnackbar(
      locale === "vi"
        ? `Đã lưu các tài nguyên đã chọn vào ${location}`
        : `Saved selected assets to ${location}`,
      { variant: "success" },
    );
  }

  async function downloadSpeechAsset(assetId: string) {
    if (!electronApi || !workspace) return;
    const location = await electronApi.assets.download(workspace.project.id, [
      assetId,
    ]);
    if (!location) {
      enqueueSnackbar(t("Download cancelled.", "Đã hủy tải xuống."), {
        variant: "info",
      });
      return;
    }
    enqueueSnackbar(
      locale === "vi"
        ? `Đã lưu file giọng đọc vào ${location}`
        : `Saved speech file to ${location}`,
      { variant: "success" },
    );
  }

  async function exportSrt() {
    if (!electronApi || !workspace) return;
    const filePath = await electronApi.transcript.exportSrt(
      workspace.project.id,
    );
    if (!filePath) {
      enqueueSnackbar(t("SRT export cancelled.", "Đã hủy xuất SRT."), {
        variant: "info",
      });
      return;
    }
    enqueueSnackbar(
      locale === "vi"
        ? `Đã xuất SRT: ${filePath}`
        : `SRT exported: ${filePath}`,
      { variant: "success" },
    );
  }

  async function generateSpeechFromTranscript() {
    if (!electronApi || !workspace) return;
    try {
      const result = await electronApi.transcript.generateSpeech(workspace.project.id);
      enqueueSnackbar(
        locale === "vi"
          ? `Đã tạo giọng đọc: ${result.asset.filePath}`
          : `Generated speech: ${result.asset.filePath}`,
        { variant: "success" },
      );
      await refreshWorkspace(workspace.project.id);
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? error.message
          : t("Speech generation failed.", "Tạo giọng đọc thất bại."),
        { variant: "error" },
      );
    }
  }

  async function generateSpeechAllInOneFromTranscript() {
    if (!electronApi || !workspace) return;
    try {
      const result = await electronApi.transcript.generateSpeechAllInOne(
        workspace.project.id,
      );
      enqueueSnackbar(
        locale === "vi"
          ? `Đã tạo giọng đọc (all in one): ${result.asset.filePath}`
          : `Generated speech (all in one): ${result.asset.filePath}`,
        { variant: "success" },
      );
      await refreshWorkspace(workspace.project.id);
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? error.message
          : t("Speech generation failed.", "Tạo giọng đọc thất bại."),
        { variant: "error" },
      );
    }
  }

  async function generateSpeechForScene(scene: Scene) {
    if (!electronApi || !workspace) return;
    try {
      const result = await electronApi.transcript.generateSpeechForScene(scene.id);
      enqueueSnackbar(
        locale === "vi"
          ? `Đã tạo giọng đọc cho cảnh ${scene.sceneIndex}: ${result.asset.filePath}`
          : `Generated speech for scene ${scene.sceneIndex}: ${result.asset.filePath}`,
        { variant: "success" },
      );
      await refreshWorkspace(workspace.project.id);
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? error.message
          : t("Speech generation failed.", "Tạo giọng đọc thất bại."),
        { variant: "error" },
      );
    }
  }

  async function generateSpeechForSceneIndex(sceneIndex: number) {
    const scene = workspace?.scenes.find((item) => item.sceneIndex === sceneIndex);
    if (!scene) {
      enqueueSnackbar(
        t("Scene not found.", "Không tìm thấy cảnh."),
        { variant: "error" },
      );
      return;
    }
    await generateSpeechForScene(scene);
  }

  async function updateTranscriptRow(
    transcriptId: string,
    patch: {
      speaker?: string;
      text?: string;
      startSec?: number;
      endSec?: number;
      voiceId?: string;
    },
  ) {
    if (!electronApi || !workspace) return;
    await electronApi.transcript.updateRow(transcriptId, patch);
    await refreshWorkspace(workspace.project.id);
    enqueueSnackbar(
      t("Transcript updated.", "Đã cập nhật lời thoại."),
      { variant: "success" },
    );
  }

  async function updateSpeakerVoice(speaker: string, voiceId: string) {
    if (!electronApi || !workspace) return;
    const affected = await electronApi.transcript.updateSpeakerVoice(
      workspace.project.id,
      speaker,
      voiceId,
    );
    await refreshWorkspace(workspace.project.id);
    enqueueSnackbar(
      locale === "vi"
        ? `Đã cập nhật voice ID cho ${affected} dòng của ${speaker}.`
        : `Updated voice ID for ${affected} rows of ${speaker}.`,
      { variant: "success" },
    );
  }

  async function copyPromptToClipboard(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    enqueueSnackbar(
      locale === "vi"
        ? `Đã sao chép ${label} vào bộ nhớ tạm.`
        : `${label} copied to clipboard.`,
      { variant: "success" },
    );
  }

  async function handleOpenLatestRelease() {
    if (!electronApi || !latestUpdate?.releaseUrl) return;
    try {
      await electronApi.app.openExternal(latestUpdate.releaseUrl);
      setShowUpdateAvailableModal(false);
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? error.message
          : t("Failed to open release page.", "Không thể mở trang release."),
        { variant: "error" },
      );
    }
  }

  function updateTaskMapping(
    task: GenerationTask,
    patch: Partial<TaskModelMapping>,
  ) {
    if (!settings) return;
    setSettings({
      ...settings,
      taskModelMappings: {
        ...settings.taskModelMappings,
        [task]: {
          ...settings.taskModelMappings[task],
          ...patch,
        },
      },
    });
  }

  function handleOpenCreateProject() {
    if (!settings) {
      enqueueSnackbar(
        t("Settings are not loaded yet.", "Cài đặt chưa được tải."),
        { variant: "warning" },
      );
      return;
    }

    const scriptMapping = settings.taskModelMappings.generateScript;
    const provider = scriptMapping?.provider;
    const model = scriptMapping?.model?.trim();
    const providerKey = provider
      ? settings.providers
          .find((item) => item.name === provider)
          ?.apiKey?.trim()
      : "";

    if (!provider || !model || !providerKey) {
      enqueueSnackbar(
        t(
          'Cannot create project: please configure "Generate Script" provider/model and API key in Settings.',
          'Không thể tạo dự án: vui lòng cấu hình provider/model của "Generate Script" và API key trong phần Cài đặt.',
        ),
        { variant: "error" },
      );
      return;
    }

    setActivePage("createProject");
  }

  if (!electronApi) {
    return (
      <div className="app-shell">
        <main className="content">
          <section className="panel empty-state">
            <h2>Bridge unavailable</h2>
            <p>
              {t(
                "Failed to load Electron preload bridge (`window.electronApi`). The app is retrying automatically. If this persists, restart dev server and Electron.",
                "Không thể tải cầu nối preload của Electron (`window.electronApi`). Ứng dụng đang tự thử lại. Nếu lỗi vẫn còn, hãy khởi động lại dev server và Electron.",
              )}
            </p>
            <button className="btn" onClick={() => window.location.reload()}>
              {t("Retry Now", "Thử lại ngay")}
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar panel">
        <div className="brand-block">
          <h1>AI Creator</h1>
          <p className="muted">
            {t("Version", "Phiên bản")}:{" "}
            {appVersion ?? latestUpdate?.currentVersion ?? "—"}
          </p>
        </div>

        <div className="nav-stack">
          <button
            className={`btn ${activePage === "workspace" ? "active" : ""}`}
            onClick={() => {
              setActivePage("workspace");
              setWorkspace(null);
            }}
          >
            {t("Workspace", "Không gian làm việc")}
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="btn btn-primary" onClick={handleOpenCreateProject}>
            {t("+ New Project", "+ Dự án mới")}
          </button>
        </div>

        <div className="sidebar-bottom">
          <button
            className={`btn btn-icon ${activePage === "settings" ? "active" : ""}`}
            onClick={() => setActivePage("settings")}
            title={t("Settings", "Cài đặt")}
            aria-label={t("Settings", "Cài đặt")}
          >
            ⚙
          </button>
        </div>
      </aside>

      <main className="content">
        {activePage === "settings" && (
          <SettingsPanel
            locale={locale}
            busy={busy}
            settings={settings}
            settingsLoadError={settingsLoadError}
            settingsTab={settingsTab}
            setSettingsTab={setSettingsTab}
            onSaveSettings={handleSaveSettings}
            onTestVoice={(sampleText) => void handleTestVoice(sampleText)}
            onRetryLoad={() => void refreshSettings()}
            onValidateProvider={(provider) => void handleValidateProvider(provider)}
            onProviderApiKeyChange={handleProviderApiKeyChange}
            onDuplicateProvider={() =>
              enqueueSnackbar(
                t(
                  "Provider already exists in list.",
                  "Provider đã tồn tại trong danh sách.",
                ),
                { variant: "warning" },
              )
            }
            setSettings={(nextSettings) => setSettings(nextSettings)}
            updateTaskMapping={updateTaskMapping}
            languageOptions={languageOptions}
            providerCatalog={providerCatalog}
            taskSupportedProviders={taskSupportedProviders}
            getCompatibleModelsForTask={getCompatibleModelsForTask}
            showElevenLabsVoiceSettings={showElevenLabsVoiceSettings}
            validatedProviders={{
              openai: Boolean(validatedProviderKeys.openai),
              gemini: Boolean(validatedProviderKeys.gemini),
              fal: Boolean(validatedProviderKeys.fal),
              elevenlabs: Boolean(validatedProviderKeys.elevenlabs),
            }}
          />
        )}

        {activePage === "workspace" && !workspace && (
          <section className="workspace panel workspace-projects">
            <div className="section-head">
              <h2>{t("Projects", "Dự án")}</h2>
              <span className="pill">{projects.length}</span>
            </div>
            <p className="muted">
              {t(
                "Select a project to open Characters, Scenes, and Transcript tabs.",
                "Chọn một dự án để mở các tab Nhân vật, Cảnh và Lời thoại.",
              )}
            </p>
            <div className="workspace-project-grid">
              {projects.map((project) => (
                <div key={project.id} className="project-card-stack">
                  <button
                    type="button"
                    className="project-card"
                    onClick={() =>
                      void refreshWorkspace(project.id, { resetTab: true })
                    }
                  >
                    <h3>{project.title}</h3>
                    <p>{project.visualStyle}</p>
                    <small>
                      {project.aspectRatio} • {project.status}
                    </small>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activePage === "createProject" && (
          <CreateProjectPanel
            locale={locale}
            projectForm={projectForm}
            setProjectForm={setProjectForm}
            busy={busy}
            onCancel={() => setActivePage("workspace")}
            onCreate={() => void handleCreateProject()}
          />
        )}

        {showUpdateAvailableModal && latestUpdate?.hasUpdate && (
          <section className="modal">
            <div
              className="modal-card panel modal-card-compact"
              role="dialog"
              aria-modal="true"
              aria-labelledby="update-modal-title"
            >
              <div className="section-head">
                <h2 id="update-modal-title">
                  {t("Update available", "Có bản cập nhật mới")}
                </h2>
              </div>
              <p className="muted">
                {t(
                  "A newer version is available. Download it from the release page.",
                  "Đã có phiên bản mới. Tải xuống từ trang release.",
                )}
              </p>
              <p>
                {t("Current", "Hiện tại")}:{" "}
                <strong>{latestUpdate.currentVersion}</strong>
                {" · "}
                {t("Latest", "Mới nhất")}:{" "}
                <strong>{latestUpdate.latestVersion}</strong>
              </p>
              <div className="inline-row modal-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowUpdateAvailableModal(false)}
                >
                  {t("Later", "Để sau")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleOpenLatestRelease()}
                >
                  {t("Open release page", "Mở trang release")}
                </button>
              </div>
            </div>
          </section>
        )}

        {activePage === "workspace" && workspace && (
          <section className="workspace panel">
            <header>
              <div>
                <h2>{workspace.project.title}</h2>
                <p className="muted">
                  {workspace.project.visualStyle} •{" "}
                  {workspace.project.aspectRatio}
                </p>
              </div>
              <div className="inline-row tab-row">
                {(["Info", "Characters", "Scenes", "Transcript"] as const).map(
                  (tab) => (
                    <button
                      key={tab}
                      className={`btn ${selectedTab === tab ? "active" : ""}`}
                      onClick={() => setSelectedTab(tab)}
                    >
                      {tab === "Info"
                        ? t("Info", "Thông tin")
                        : tab === "Characters"
                          ? t("Characters", "Nhân vật")
                          : tab === "Scenes"
                            ? t("Scenes", "Cảnh")
                            : t("Transcript", "Lời thoại")}
                    </button>
                  ),
                )}
              </div>
            </header>

            {workspace.project.status === "error" && (
              <div className="workspace-script-error-banner" role="alert">
                <div className="workspace-script-error-text">
                  <strong>
                    {t("Script generation failed", "Tạo kịch bản thất bại")}
                  </strong>
                  {workspace.project.statusDetail ? (
                    <p className="muted">{workspace.project.statusDetail}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={retryingScriptProjectId === workspace.project.id}
                  onClick={() =>
                    void handleRetryGenerateScript(workspace.project.id)
                  }
                >
                  {retryingScriptProjectId === workspace.project.id
                    ? t("Retrying...", "Đang thử lại...")
                    : t("Retry script generation", "Tạo lại kịch bản")}
                </button>
              </div>
            )}

            <div className="download-strip">
              <p>
                {selectedAssetIds.length}{" "}
                {t("assets selected", "tài nguyên đã chọn")}
              </p>
              <button
                className="btn"
                onClick={() => void downloadSelected()}
                disabled={selectedAssetIds.length === 0}
              >
                {t("Download Selected", "Tải đã chọn")}
              </button>
            </div>

            {selectedTab === "Info" && (
              <InfoView project={workspace.project} locale={locale} />
            )}

            {selectedTab === "Characters" && (
              <CharactersView
                characters={workspace.characters}
                assetsByEntity={assetsByEntity}
                generatingCharacterIds={generatingCharacterIds}
                selectedAssetIds={selectedAssetIds}
                onOpenLightbox={(src, alt) => setLightboxImage({ src, alt })}
                onUpdatePrompt={updateCharacterPrompt}
                onToggleAsset={(assetId) =>
                  setSelectedAssetIds((previous) =>
                    previous.includes(assetId)
                      ? previous.filter((id) => id !== assetId)
                      : [...previous, assetId],
                  )
                }
                onGenerateImage={regenerateCharacterImage}
                canGenerateImage={canGenerateImage}
                toRenderableSrc={toRenderableSrc}
                locale={locale}
                onCopyPrompt={(character, prompt) =>
                  void copyPromptToClipboard(`${character.name} prompt`, prompt)
                }
              />
            )}

            {selectedTab === "Scenes" && (
              <ScenesView
                scenes={workspace.scenes}
                assetsByEntity={assetsByEntity}
                generatingSceneIds={generatingSceneIds}
                selectedAssetIds={selectedAssetIds}
                onOpenLightbox={(src, alt) => setLightboxImage({ src, alt })}
                onToggleAsset={(assetId) =>
                  setSelectedAssetIds((previous) =>
                    previous.includes(assetId)
                      ? previous.filter((id) => id !== assetId)
                      : [...previous, assetId],
                  )
                }
                onGenerateImage={regenerateSceneImage}
                onGenerateVideo={generateSceneVideo}
                canGenerateImage={canGenerateImage}
                canGenerateVideo={canGenerateVideo}
                toRenderableSrc={toRenderableSrc}
                locale={locale}
                onUpdatePrompts={updateScenePrompts}
                onCopyTextPrompt={(scene, prompt) =>
                  void copyPromptToClipboard(
                    `Scene ${scene.sceneIndex} text-to-image prompt`,
                    prompt,
                  )
                }
                onCopyVideoPrompt={(scene, prompt) =>
                  void copyPromptToClipboard(
                    `Scene ${scene.sceneIndex} image-to-video prompt`,
                    prompt,
                  )
                }
              />
            )}

            {selectedTab === "Transcript" && (
              <TranscriptView
                transcripts={workspace.transcripts}
                untimedTranscript={untimedTranscript}
                onExportSrt={exportSrt}
                onGenerateSpeechSceneByScene={generateSpeechFromTranscript}
                onGenerateSpeechAllInOne={generateSpeechAllInOneFromTranscript}
                onGenerateSpeechForScene={(scene) =>
                  void generateSpeechForSceneIndex(scene)
                }
                onUpdateRow={updateTranscriptRow}
                onUpdateSpeakerVoice={updateSpeakerVoice}
                speechAssets={speechAssets ?? []}
                toRenderableSrc={toRenderableSrc}
                onDownloadSpeech={(assetId) => void downloadSpeechAsset(assetId)}
                locale={locale}
              />
            )}
          </section>
        )}

        {lightboxImage && (
          <section className="lightbox" onClick={() => setLightboxImage(null)}>
            <button
              className="lightbox-close"
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="Close image preview"
            >
              ✕
            </button>
            <img
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              className="lightbox-image"
              onClick={(event) => event.stopPropagation()}
            />
          </section>
        )}
      </main>
    </div>
  );
}

