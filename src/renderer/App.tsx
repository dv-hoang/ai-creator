import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSnackbar } from "notistack";
import type {
  AppSettings,
  AssetRecord,
  Character,
  GenerationTask,
  ProjectInput,
  ProjectRecord,
  ProjectWorkspace,
  Scene,
  TaskModelMapping,
  TranscriptRow,
} from "@shared/types";

const languageOptions = [
  { label: "English", value: "en" },
  { label: "Vietnamese", value: "vi" },
] as const;

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
] as const;
const providers = [
  { label: "OpenAI", value: "openai" },
  { label: "Gemini", value: "gemini" },
] as const;

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
  if (/^(https?:|file:|data:)/i.test(filePath)) {
    return filePath;
  }
  const normalized = filePath.replaceAll("\\", "/");
  const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(absolutePath)}`;
}

export function App() {
  const [electronApi, setElectronApi] = useState<typeof window.electronApi | null>(
    window.electronApi ?? null,
  );
  const [activePage, setActivePage] = useState<"workspace" | "settings">(
    "workspace",
  );
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedTab, setSelectedTab] = useState<
    "Characters" | "Scenes" | "Transcript"
  >("Characters");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [projectForm, setProjectForm] =
    useState<ProjectInput>(emptyProjectInput);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [untimedTranscript, setUntimedTranscript] = useState("");
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [generatingCharacterIds, setGeneratingCharacterIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [generatingSceneIds, setGeneratingSceneIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { enqueueSnackbar } = useSnackbar();

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
      setSettingsLoadError(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load settings.";
      setSettingsLoadError(message);
      enqueueSnackbar(`Settings load failed: ${message}`, { variant: "error" });
    }
  }

  async function refreshWorkspace(projectId: string) {
    if (!electronApi) return;
    const next = await electronApi.projects.getWorkspace(projectId);
    setWorkspace(next);
    const nextAssets = await electronApi.assets.listByProject(projectId);
    setAssets(nextAssets);
    setSelectedAssetIds([]);
    const transcriptText =
      await electronApi.transcript.untimedText(projectId);
    setUntimedTranscript(transcriptText);
  }

  useEffect(() => {
    if (!electronApi) {
      return;
    }

    void (async () => {
      await refreshSettings();
      try {
        await refreshProjects();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load projects.";
        enqueueSnackbar(`Projects load failed: ${message}`, { variant: "error" });
      }
    })();
  }, [electronApi, enqueueSnackbar]);

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

  async function handleSaveSettings() {
    if (!settings || !electronApi) return;
    setBusy(true);
    try {
      const saved = await electronApi.settings.save(settings);
      setSettings(saved);
      const openAiModels = saved.providerModels.openai?.length ?? 0;
      const geminiModels = saved.providerModels.gemini?.length ?? 0;
      enqueueSnackbar(
        `Global app settings saved. Loaded models: OpenAI ${openAiModels}, Gemini ${geminiModels}.`,
        { variant: "success" },
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateProject() {
    if (!electronApi) return;
    setBusy(true);
    enqueueSnackbar("Creating project...", { variant: "info" });
    try {
      const created = await electronApi.projects.create(projectForm);
      setWorkspace(created);
      setShowCreateProject(false);
      setProjectForm(emptyProjectInput);
      await refreshProjects();
      const nextAssets = await electronApi.assets.listByProject(
        created.project.id,
      );
      setAssets(nextAssets);
      enqueueSnackbar(
        "Project created. Step 1 generation is running in background.",
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

  async function handleValidateProvider(provider: "openai" | "gemini") {
    if (!electronApi) return;
    const apiKey = settings?.providerKeys[provider]?.trim() ?? "";
    const result = await electronApi.settings.validateProvider(provider, apiKey);
    enqueueSnackbar(result.message, {
      variant: result.ok ? "success" : "error",
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
      enqueueSnackbar(`Generated image for ${character.name}`, {
        variant: "success",
      });
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? `Failed to generate image for ${character.name}: ${error.message}`
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
      enqueueSnackbar(`Generated image for scene ${scene.sceneIndex}`, {
        variant: "success",
      });
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? `Failed to generate image for scene ${scene.sceneIndex}: ${error.message}`
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
        "Generate or link a scene image before creating a video.",
        { variant: "warning" },
      );
      return;
    }

    setBusy(true);
    try {
      await electronApi.scenes.generateVideo(scene.id, imageAsset.id);
      if (workspace) await refreshWorkspace(workspace.project.id);
      enqueueSnackbar(`Generated video for scene ${scene.sceneIndex}`, {
        variant: "success",
      });
    } catch (error) {
      enqueueSnackbar(
        error instanceof Error
          ? `Failed to generate video for scene ${scene.sceneIndex}: ${error.message}`
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
      enqueueSnackbar("Download cancelled.", { variant: "info" });
      return;
    }
    enqueueSnackbar(`Saved selected assets to ${location}`, { variant: "success" });
  }

  async function exportSrt() {
    if (!electronApi || !workspace) return;
    const filePath = await electronApi.transcript.exportSrt(
      workspace.project.id,
    );
    if (!filePath) {
      enqueueSnackbar("SRT export cancelled.", { variant: "info" });
      return;
    }
    enqueueSnackbar(`SRT exported: ${filePath}`, { variant: "success" });
  }

  async function copyPromptToClipboard(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    enqueueSnackbar(`${label} copied to clipboard.`, { variant: "success" });
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
      enqueueSnackbar("Settings are not loaded yet.", { variant: "warning" });
      return;
    }

    const scriptMapping = settings.taskModelMappings.generateScript;
    const provider = scriptMapping?.provider;
    const model = scriptMapping?.model?.trim();
    const providerKey = provider ? settings.providerKeys[provider]?.trim() : "";

    if (!provider || !model || !providerKey) {
      enqueueSnackbar(
        'Cannot create project: please configure "Generate Script" provider/model and API key in Settings.',
        { variant: "error" },
      );
      return;
    }

    setShowCreateProject(true);
  }

  if (!electronApi) {
    return (
      <div className="app-shell">
        <main className="content">
          <section className="panel empty-state">
            <h2>Bridge unavailable</h2>
            <p>
              Failed to load Electron preload bridge (`window.electronApi`).
              The app is retrying automatically. If this persists, restart dev
              server and Electron.
            </p>
            <button
              className="btn"
              onClick={() => window.location.reload()}
            >
              Retry Now
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
          <p className="muted">Desktop Studio</p>
        </div>

        <div className="nav-stack">
          <button
            className={`btn ${activePage === "workspace" ? "active" : ""}`}
            onClick={() => {
              setActivePage("workspace");
              setWorkspace(null);
            }}
          >
            Workspace
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            className="btn btn-primary"
            onClick={handleOpenCreateProject}
          >
            + New Project
          </button>
        </div>

        <div className="sidebar-bottom">
          <button
            className={`btn btn-icon ${activePage === "settings" ? "active" : ""}`}
            onClick={() => setActivePage("settings")}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </aside>

      <main className="content">
        {activePage === "settings" && (
          <section className="settings-panel panel">
            <div className="section-head">
              <h2>Global Settings</h2>
              <div className="inline-row">
                {busy && <span className="pill">Working...</span>}
                <button
                  className="btn btn-primary"
                  onClick={handleSaveSettings}
                  disabled={!settings || busy}
                >
                  Save Settings
                </button>
              </div>
            </div>
            {settings && (
              <>
                <div className="panel-subtle empty-state">
                  <p>
                    These settings are global for the entire app (all projects):
                    language, provider API keys, and provider/model task mapping.
                  </p>
                </div>
                <label>
                  App Language
                  <select
                    value={settings.language}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        language: event.target.value as AppSettings["language"],
                      })
                    }
                  >
                    {languageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="provider-keys">
                  {providers.map((provider) => (
                    <label key={provider.value}>
                      {provider.label} Global API Key
                      <div className="inline-row">
                        <input
                          type="password"
                          value={settings.providerKeys[provider.value] ?? ""}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              providerKeys: {
                                ...settings.providerKeys,
                                [provider.value]: event.target.value,
                              },
                            })
                          }
                        />
                        <button
                          className="btn"
                          onClick={() =>
                            void handleValidateProvider(provider.value)
                          }
                        >
                          Validate
                        </button>
                      </div>
                    </label>
                  ))}
                </div>

                {(
                  [
                    "generateScript",
                    "generateImage",
                    "generateVideo",
                  ] as GenerationTask[]
                ).map((task) => (
                  <div key={task} className="task-mapping-row">
                    <h4>{task}</h4>
                    <select
                      value={settings.taskModelMappings[task].provider}
                      onChange={(event) =>
                        (() => {
                          const nextProvider = event.target
                            .value as TaskModelMapping["provider"];
                          const availableModels =
                            settings.providerModels[nextProvider] ?? [];
                          const fallbackModel =
                            availableModels[0] ??
                            settings.taskModelMappings[task].model;

                          updateTaskMapping(task, {
                            provider: nextProvider,
                            model: fallbackModel,
                          });
                        })()
                      }
                    >
                      {providers.map((provider) => (
                        <option key={provider.value} value={provider.value}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={settings.taskModelMappings[task].model}
                      onChange={(event) =>
                        updateTaskMapping(task, { model: event.target.value })
                      }
                      disabled={
                        (settings.providerModels[
                          settings.taskModelMappings[task].provider
                        ]?.length ?? 0) === 0
                      }
                    >
                      {(settings.providerModels[
                        settings.taskModelMappings[task].provider
                      ]?.length ?? 0) === 0 ? (
                        <option value={settings.taskModelMappings[task].model}>
                          No models loaded for this provider
                        </option>
                      ) : (
                        (settings.providerModels[
                          settings.taskModelMappings[task].provider
                        ] ?? []).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                ))}
              </>
            )}
            {!settings && (
              <div className="panel-subtle empty-state">
                <p>
                  Settings are not available yet.
                  {settingsLoadError ? ` ${settingsLoadError}` : ""}
                </p>
                <button
                  className="btn"
                  onClick={() => void refreshSettings()}
                  disabled={busy}
                >
                  Retry Loading Settings
                </button>
              </div>
            )}
          </section>
        )}

        {activePage === "workspace" && !workspace && (
          <section className="workspace panel workspace-projects">
            <div className="section-head">
              <h2>Projects</h2>
              <span className="pill">{projects.length}</span>
            </div>
            <p className="muted">
              Select a project to open Characters, Scenes, and Transcript tabs.
            </p>
            <div className="workspace-project-grid">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className="project-card"
                  onClick={() => void refreshWorkspace(project.id)}
                >
                  <h3>{project.title}</h3>
                  <p>{project.visualStyle}</p>
                  <small>
                    {project.aspectRatio} • {project.status}
                  </small>
                </button>
              ))}
            </div>
          </section>
        )}

        {showCreateProject && (
          <section className="modal">
            <div className="modal-card panel">
              <div className="section-head">
                <h2>Create Project</h2>
                <span className="pill">Step 1 Setup</span>
              </div>
              <label>
                Title
                <input
                  value={projectForm.title}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      title: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Content (ORIGINAL_CONTENT)
                <textarea
                  value={projectForm.originalContent}
                  rows={6}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      originalContent: event.target.value,
                    })
                  }
                />
              </label>
              <div className="two-col">
                <label>
                  Prompt Language
                  <select
                    value={projectForm.promptLanguage}
                    onChange={(event) =>
                      setProjectForm({
                        ...projectForm,
                        promptLanguage: event.target
                          .value as ProjectInput["promptLanguage"],
                      })
                    }
                  >
                    {promptLanguageOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Story Language
                  <select
                    value={projectForm.transcriptLanguagePolicy}
                    onChange={(event) =>
                      setProjectForm({
                        ...projectForm,
                        transcriptLanguagePolicy: event.target
                          .value as ProjectInput["transcriptLanguagePolicy"],
                      })
                    }
                  >
                    {promptLanguageOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Size / Aspect Ratio
                  <div className="aspect-ratio-picker">
                    {aspectRatioPresets.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`aspect-ratio-item ${projectForm.aspectRatio === preset.value ? "active" : ""}`}
                        onClick={() =>
                          setProjectForm({
                            ...projectForm,
                            aspectRatio: preset.value,
                          })
                        }
                      >
                        <span
                          className="ratio-icon"
                          style={
                            {
                              "--ratio-w": String(preset.width),
                              "--ratio-h": String(preset.height),
                            } as CSSProperties
                          }
                        >
                          <span className="ratio-frame" />
                        </span>
                        <span>{preset.value}</span>
                      </button>
                    ))}
                  </div>
                </label>
              </div>
              <label>
                Visual Style
                <select
                  value={projectForm.visualStyle}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
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
              </label>
              <label>
                Art Direction Hint
                <textarea
                  rows={3}
                  value={projectForm.artDirectionHint}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      artDirectionHint: event.target.value,
                    })
                  }
                />
              </label>

              <div className="inline-row modal-actions">
                <button
                  className="btn"
                  onClick={() => setShowCreateProject(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleCreateProject()}
                  disabled={
                    busy || !projectForm.title || !projectForm.originalContent
                  }
                >
                  Create + Generate Step 1
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
                {(["Characters", "Scenes", "Transcript"] as const).map(
                  (tab) => (
                    <button
                      key={tab}
                      className={`btn ${selectedTab === tab ? "active" : ""}`}
                      onClick={() => setSelectedTab(tab)}
                    >
                      {tab}
                    </button>
                  ),
                )}
              </div>
            </header>

            <div className="download-strip">
              <p>{selectedAssetIds.length} assets selected</p>
              <button
                className="btn"
                onClick={() => void downloadSelected()}
                disabled={selectedAssetIds.length === 0}
              >
                Download Selected
              </button>
            </div>

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
              />
            )}
          </section>
        )}

        {lightboxImage && (
          <section
            className="lightbox"
            onClick={() => setLightboxImage(null)}
          >
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

function CharactersView(props: {
  characters: Character[];
  assetsByEntity: Map<string, AssetRecord[]>;
  generatingCharacterIds: Set<string>;
  selectedAssetIds: string[];
  onOpenLightbox: (src: string, alt: string) => void;
  onUpdatePrompt: (character: Character, prompt: string) => void;
  onToggleAsset: (assetId: string) => void;
  onGenerateImage: (character: Character) => void;
  onCopyPrompt: (character: Character, prompt: string) => void;
}) {
  return (
    <div className="entity-grid">
      {props.characters.map((character) => {
        const prompt = character.promptOverride ?? character.promptTextToImage;
        const imageAsset = (props.assetsByEntity.get(`character:${character.id}`) ?? []).find(
          (asset) => asset.kind === "image",
        );

        return (
          <article key={character.id} className="entity-card panel-subtle">
            <h3>{character.name} Prompt</h3>
            <div className="character-layout">
              <div className="character-preview">
                {imageAsset ? (
                  <>
                    <img
                      src={toRenderableSrc(imageAsset.filePath)}
                      alt={`${character.name} generated`}
                      className="media-thumb character-thumb"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onOpenLightbox(
                          toRenderableSrc(imageAsset.filePath),
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
                      image • {imageAsset.model}
                    </label>
                  </>
                ) : (
                  <div className="character-placeholder">
                    No generated image yet
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
                  placeholder="Character text-to-image prompt"
                />
                <div className="inline-row">
                  <button
                    className="btn"
                    onClick={() => void props.onGenerateImage(character)}
                    disabled={props.generatingCharacterIds.has(character.id)}
                  >
                    {props.generatingCharacterIds.has(character.id)
                      ? "Generating..."
                      : "Generate Image"}
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ScenesView(props: {
  scenes: Scene[];
  assetsByEntity: Map<string, AssetRecord[]>;
  generatingSceneIds: Set<string>;
  selectedAssetIds: string[];
  onOpenLightbox: (src: string, alt: string) => void;
  onToggleAsset: (assetId: string) => void;
  onGenerateImage: (scene: Scene) => void;
  onGenerateVideo: (scene: Scene) => void;
  onUpdatePrompts: (
    scene: Scene,
    nextTextToImage: string,
    nextImageToVideo: string,
  ) => void;
  onCopyTextPrompt: (scene: Scene, prompt: string) => void;
  onCopyVideoPrompt: (scene: Scene, prompt: string) => void;
}) {
  return (
    <div className="entity-grid">
      {props.scenes.map((scene) => {
        const assets = (props.assetsByEntity.get(`scene:${scene.id}`) ?? []).filter(
          (asset) => asset.kind === "image",
        );
        const videos = (props.assetsByEntity.get(`video:${scene.id}`) ?? []).filter(
          (asset) => asset.kind === "video",
        );
        const textPrompt =
          scene.promptOverrideTextToImage ?? scene.promptTextToImage;
        const videoPrompt =
          scene.promptOverrideImageToVideo ?? scene.promptImageToVideo;

        return (
          <article key={scene.id} className="entity-card panel-subtle">
            <h3>
              Scene {scene.sceneIndex}: {scene.title}
            </h3>
            <div className="scene-layout">
              <div className="scene-preview">
                {assets[0] ? (
                  <label className="media-card">
                    <img
                      src={toRenderableSrc(assets[0].filePath)}
                      alt={`Scene ${scene.sceneIndex} generated`}
                      className="media-thumb"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onOpenLightbox(
                          toRenderableSrc(assets[0].filePath),
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
                      image • {assets[0].model}
                    </span>
                  </label>
                ) : (
                  <div className="scene-placeholder">
                    No generated scene image yet
                  </div>
                )}
                {videos[0] && (
                  <label className="media-card">
                    <video
                      src={toRenderableSrc(videos[0].filePath)}
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
                      video • {videos[0].model}
                    </span>
                  </label>
                )}
              </div>
              <div className="scene-editor">
                <p>{scene.summary}</p>
                <div className="refs-highlight">
                  <strong>Needs refs</strong>
                  <div className="refs-list">
                    {scene.requiredCharacterRefs.length > 0 ? (
                      scene.requiredCharacterRefs.map((refName) => (
                        <span key={`${scene.id}-${refName}`} className="ref-chip">
                          {refName}
                        </span>
                      ))
                    ) : (
                      <span className="ref-chip ref-chip-empty">None</span>
                    )}
                  </div>
                </div>
                <label>
                  Text to image prompt
                  <HoverCopyTextarea
                    rows={4}
                    value={textPrompt}
                    onChange={(nextValue) =>
                      void props.onUpdatePrompts(
                        scene,
                        nextValue,
                        videoPrompt,
                      )
                    }
                    onCopy={() => void props.onCopyTextPrompt(scene, textPrompt)}
                  />
                </label>
                <label>
                  Image to video prompt
                  <HoverCopyTextarea
                    rows={4}
                    value={videoPrompt}
                    onChange={(nextValue) =>
                      void props.onUpdatePrompts(
                        scene,
                        textPrompt,
                        nextValue,
                      )
                    }
                    onCopy={() => void props.onCopyVideoPrompt(scene, videoPrompt)}
                  />
                </label>
                <div className="inline-row">
                  <button
                    className="btn"
                    onClick={() => void props.onGenerateImage(scene)}
                    disabled={props.generatingSceneIds.has(scene.id)}
                  >
                    {props.generatingSceneIds.has(scene.id)
                      ? "Generating..."
                      : "Generate Scene Image"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => void props.onGenerateVideo(scene)}
                  >
                    Generate Video
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function HoverCopyTextarea(props: {
  value: string;
  rows: number;
  onChange: (value: string) => void;
  onCopy: () => void;
  placeholder?: string;
}) {
  return (
    <div className="textarea-copy-wrap">
      <textarea
        rows={props.rows}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      <button
        type="button"
        className="copy-icon-btn"
        onClick={props.onCopy}
        aria-label="Copy to clipboard"
        title="Copy to clipboard"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 9h11v11H9z" />
          <path d="M4 4h11v2H6v9H4z" />
        </svg>
      </button>
    </div>
  );
}

function TranscriptView(props: {
  transcripts: TranscriptRow[];
  untimedTranscript: string;
  onExportSrt: () => void;
}) {
  return (
    <div className="transcript-view panel-subtle">
      <div className="inline-row">
        <h3>Transcript</h3>
        <button
          className="btn"
          onClick={() =>
            void navigator.clipboard.writeText(props.untimedTranscript)
          }
        >
          Copy Untimed Transcript
        </button>
        <button className="btn" onClick={() => void props.onExportSrt()}>
          Export .srt
        </button>
      </div>
      <textarea readOnly rows={8} value={props.untimedTranscript} />
      <div className="table-like">
        {props.transcripts.map((row) => (
          <div key={row.id} className="table-row">
            <span>Scene {row.scene}</span>
            <span>{row.speaker}</span>
            <span>
              {row.startSec} - {row.endSec}
            </span>
            <span>{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
