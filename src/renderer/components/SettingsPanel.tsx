import { useEffect, useState } from "react";
import type {
  AppSettings,
  GenerationTask,
  ProviderName,
  TaskModelMapping,
} from "@shared/types";

type SettingsTab = "general" | "providers" | "controls";

export function SettingsPanel(props: {
  locale: "en" | "vi";
  busy: boolean;
  settings: AppSettings | null;
  settingsLoadError: string | null;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  onSaveSettings: () => void;
  onTestVoice: (text: string) => void;
  onRetryLoad: () => void;
  onValidateProvider: (provider: TaskModelMapping["provider"]) => void;
  onProviderApiKeyChange: (provider: ProviderName, apiKey: string) => void;
  onDuplicateProvider: () => void;
  setSettings: (settings: AppSettings) => void;
  updateTaskMapping: (
    task: GenerationTask,
    patch: Partial<TaskModelMapping>,
  ) => void;
  languageOptions: ReadonlyArray<{ label: string; value: "en" | "vi" }>;
  providerCatalog: ReadonlyArray<{
    label: string;
    value: TaskModelMapping["provider"];
  }>;
  taskSupportedProviders: Record<
    GenerationTask,
    TaskModelMapping["provider"][]
  >;
  getCompatibleModelsForTask: (
    task: GenerationTask,
    provider: TaskModelMapping["provider"],
    models: string[],
  ) => string[];
  showElevenLabsVoiceSettings: boolean;
  validatedProviders: Partial<Record<ProviderName, boolean>>;
}) {
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  const defaultVoicePreviewText = t(
    "Hello, this is a quick voice preview from AI Creator.",
    "Xin chao, day la doan thu giong noi nhanh tu AI Creator.",
  );
  const [voicePreviewText, setVoicePreviewText] = useState(defaultVoicePreviewText);

  useEffect(() => {
    setVoicePreviewText(defaultVoicePreviewText);
  }, [defaultVoicePreviewText]);

  return (
    <section className="settings-panel panel">
      <div className="section-head">
        <h2>{t("Global Settings", "Cài đặt toàn cục")}</h2>
        <div className="inline-row">
          {props.busy && (
            <span className="pill">{t("Working...", "Đang xử lý...")}</span>
          )}
          <button
            className="btn btn-primary"
            onClick={props.onSaveSettings}
            disabled={!props.settings || props.busy}
          >
            {t("Save Settings", "Lưu cài đặt")}
          </button>
        </div>
      </div>
      <div className="settings-tabs">
        <button
          className={`btn ${props.settingsTab === "general" ? "active" : ""}`}
          onClick={() => props.setSettingsTab("general")}
        >
          {t("General", "Chung")}
        </button>
        <button
          className={`btn ${props.settingsTab === "providers" ? "active" : ""}`}
          onClick={() => props.setSettingsTab("providers")}
        >
          {t("AI Providers", "AI Providers")}
        </button>
        <button
          className={`btn ${props.settingsTab === "controls" ? "active" : ""}`}
          onClick={() => props.setSettingsTab("controls")}
        >
          {t("Generation Controls", "Điều khiển tạo nội dung")}
        </button>
      </div>
      {props.settings && (
        <>
          {props.settingsTab === "general" && (
            <>
              <div className="panel-subtle empty-state">
                <p>
                  {t(
                    "These settings are global for the entire app (all projects): language, provider list, provider API keys, and provider/model task mapping.",
                    "Các cài đặt này áp dụng toàn cục cho toàn bộ ứng dụng (mọi dự án): ngôn ngữ, danh sách provider, API key của provider, và mapping provider/model theo tác vụ.",
                  )}
                </p>
              </div>
              <label>
                {t("App Language", "Ngôn ngữ ứng dụng")}
                <select
                  value={props.settings.language}
                  onChange={(event) =>
                    props.setSettings({
                      ...props.settings!,
                      language: event.target.value as AppSettings["language"],
                    })
                  }
                >
                  {props.languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value === "en"
                        ? t("English", "Tiếng Anh")
                        : t("Vietnamese", "Tiếng Việt")}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {props.settingsTab === "providers" && (
            <>
              <div className="panel-subtle p-2">
                <strong>{t("Provider List", "Danh sách provider")}</strong>
                <div
                  className="inline-row"
                  style={{ marginTop: 8, flexWrap: "wrap", width: "100%" }}
                >
                  {props.settings.providers.map((providerRecord, index) => {
                    const provider = props.providerCatalog.find(
                      (item) => item.value === providerRecord.name,
                    );
                    if (!provider) return null;
                    return (
                      <div
                        key={`${providerRecord.name}-${index}`}
                        className="inline-row"
                        style={{ width: "100%" }}
                      >
                        <select
                          value={providerRecord.name}
                          onChange={(event) => {
                            const nextName = event.target
                              .value as TaskModelMapping["provider"];
                            const duplicate = props.settings!.providers.some(
                              (item, itemIndex) =>
                                itemIndex !== index && item.name === nextName,
                            );
                            if (duplicate) {
                              props.onDuplicateProvider();
                              return;
                            }
                            const nextProviders = props.settings!.providers.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: nextName }
                                  : item,
                            );
                            props.setSettings({
                              ...props.settings!,
                              providers: nextProviders,
                            });
                          }}
                        >
                          {props.providerCatalog.map((catalogItem) => (
                            <option key={catalogItem.value} value={catalogItem.value}>
                              {catalogItem.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="password"
                          placeholder={t("API key", "API key")}
                          value={providerRecord.apiKey}
                          onChange={(event) => {
                            const nextApiKey = event.target.value;
                            props.onProviderApiKeyChange(
                              providerRecord.name,
                              nextApiKey,
                            );
                            const nextProviders = props.settings!.providers.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, apiKey: nextApiKey }
                                  : item,
                            );
                            props.setSettings({
                              ...props.settings!,
                              providers: nextProviders,
                            });
                          }}
                        />
                        <button
                          className="btn"
                          onClick={() => props.onValidateProvider(providerRecord.name)}
                        >
                          {t("Validate", "Kiểm tra")}
                        </button>
                        {props.validatedProviders[providerRecord.name] && (
                          <span className="pill">
                            {t("Validated", "Đã xác thực")}
                          </span>
                        )}
                        <button
                          className="btn btn-icon"
                          type="button"
                          onClick={() => {
                            const nextProviders = props.settings!.providers.filter(
                              (_, itemIndex) => itemIndex !== index,
                            );
                            const nextTaskModelMappings = {
                              ...props.settings!.taskModelMappings,
                            };
                            (
                              [
                                "generateScript",
                                "generateImage",
                                "generateVideo",
                                "textToSpeech",
                              ] as GenerationTask[]
                            ).forEach((task) => {
                              const configuredProviderNames = nextProviders
                                .filter((item) => item.apiKey.trim())
                                .map((item) => item.name);
                              const supportedFallback = configuredProviderNames[0];
                              if (
                                !configuredProviderNames.includes(
                                  nextTaskModelMappings[task].provider,
                                ) &&
                                supportedFallback
                              ) {
                                nextTaskModelMappings[task] = {
                                  ...nextTaskModelMappings[task],
                                  provider: supportedFallback,
                                };
                              }
                            });

                            props.setSettings({
                              ...props.settings!,
                              providers: nextProviders,
                              taskModelMappings: nextTaskModelMappings,
                            });
                          }}
                          aria-label={t("Remove provider", "Xóa provider")}
                          title={t("Remove provider", "Xóa provider")}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="inline-row" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      const available =
                        props.providerCatalog.find(
                          (provider) =>
                            !props.settings!.providers.some(
                              (item) => item.name === provider.value,
                            ),
                        )?.value ?? props.providerCatalog[0].value;
                      props.setSettings({
                        ...props.settings!,
                        providers: [
                          ...props.settings!.providers,
                          {
                            name: available,
                            apiKey: "",
                          },
                        ],
                      });
                    }}
                  >
                    {t("Add Provider", "Thêm provider")}
                  </button>
                </div>
              </div>

              {(
                [
                  "generateScript",
                  "generateImage",
                  "generateVideo",
                  "textToSpeech",
                ] as GenerationTask[]
              ).map((task) => {
                const configuredProviderNames = props.settings!.providers
                  .filter((provider) => provider.apiKey.trim())
                  .map((provider) => provider.name);
                const supportedProviders = props.providerCatalog.filter(
                  (provider) =>
                    configuredProviderNames.includes(provider.value) &&
                    props.taskSupportedProviders[task].includes(provider.value),
                );
                const currentProvider = supportedProviders.some(
                  (provider) =>
                    provider.value === props.settings!.taskModelMappings[task].provider,
                )
                  ? props.settings!.taskModelMappings[task].provider
                  : (supportedProviders[0]?.value ?? "");
                const modelsForCurrentProvider = currentProvider
                  ? props.getCompatibleModelsForTask(
                      task,
                      currentProvider as TaskModelMapping["provider"],
                      props.settings!.providerModels[
                        currentProvider as TaskModelMapping["provider"]
                      ] ?? [],
                    )
                  : [];

                return (
                  <div key={task} className="task-mapping-row">
                    <h4>{task}</h4>
                    <select
                      value={currentProvider}
                      onChange={(event) => {
                        const nextProvider = event.target
                          .value as TaskModelMapping["provider"];
                        const availableModels = props.getCompatibleModelsForTask(
                          task,
                          nextProvider,
                          props.settings!.providerModels[nextProvider] ?? [],
                        );
                        const fallbackModel =
                          availableModels[0] ??
                          props.settings!.taskModelMappings[task].model;

                        props.updateTaskMapping(task, {
                          provider: nextProvider,
                          model: fallbackModel,
                        });
                      }}
                    >
                      {supportedProviders.length === 0 ? (
                        <option value="">
                          {t(
                            "No configured provider key",
                            "Chưa có provider nào có API key",
                          )}
                        </option>
                      ) : (
                        supportedProviders.map((provider) => (
                          <option key={provider.value} value={provider.value}>
                            {provider.label}
                          </option>
                        ))
                      )}
                    </select>
                    <select
                      value={
                        modelsForCurrentProvider.includes(
                          props.settings!.taskModelMappings[task].model,
                        )
                          ? props.settings!.taskModelMappings[task].model
                          : (modelsForCurrentProvider[0] ??
                            props.settings!.taskModelMappings[task].model)
                      }
                      onChange={(event) =>
                        props.updateTaskMapping(task, {
                          model: event.target.value,
                        })
                      }
                      disabled={modelsForCurrentProvider.length === 0}
                    >
                      {modelsForCurrentProvider.length === 0 ? (
                        <option value={props.settings!.taskModelMappings[task].model}>
                          {t(
                            "No models loaded for this provider",
                            "Chưa có model nào được tải cho provider này",
                          )}
                        </option>
                      ) : (
                        modelsForCurrentProvider.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      )}
                    </select>
                    {task === "textToSpeech" && props.showElevenLabsVoiceSettings && (
                      <label style={{ gridColumn: "1 / -1" }}>
                        {t("ElevenLabs Voice ID", "ElevenLabs Voice ID")}
                        <div className="inline-row">
                          <input
                            placeholder="EXAVITQu4vr4xnSDxMaL"
                            value={props.settings.elevenLabsVoiceId}
                            onChange={(event) =>
                              props.setSettings({
                                ...props.settings!,
                                elevenLabsVoiceId: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <label>
                            {t("Test voice text", "Nội dung thử giọng")}
                            <textarea
                              rows={3}
                              placeholder={defaultVoicePreviewText}
                              value={voicePreviewText}
                              onChange={(event) =>
                                setVoicePreviewText(event.target.value)
                              }
                            />
                          </label>
                        </div>
                        <div className="inline-row" style={{ marginTop: 8 }}>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => props.onTestVoice(voicePreviewText)}
                            disabled={props.busy}
                          >
                            {t("Text with text", "Thử với nội dung")}
                          </button>
                        </div>
                      </label>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {props.settingsTab === "controls" && (
            <div className="panel-subtle generation-toggles p-2">
              <strong>{t("Generation Controls", "Điều khiển tạo nội dung")}</strong>
              <div className="generation-toggle-row">
                <span>
                  {t(
                    "Enable Generate Image buttons (Characters & Scenes)",
                    "Bật nút tạo ảnh (Nhân vật & Cảnh)",
                  )}
                </span>
                <label
                  className="switch"
                  aria-label={t("Toggle generate image", "Bật/tắt tạo ảnh")}
                >
                  <input
                    type="checkbox"
                    checked={props.settings.generationEnabled.generateImage}
                    onChange={() =>
                      props.setSettings({
                        ...props.settings!,
                        generationEnabled: {
                          ...props.settings!.generationEnabled,
                          generateImage:
                            !props.settings!.generationEnabled.generateImage,
                        },
                      })
                    }
                  />
                  <span className="switch-slider" />
                </label>
              </div>
              <div className="generation-toggle-row">
                <span>
                  {t(
                    "Enable Generate Video button (Scenes)",
                    "Bật nút tạo video (Cảnh)",
                  )}
                </span>
                <label
                  className="switch"
                  aria-label={t("Toggle generate video", "Bật/tắt tạo video")}
                >
                  <input
                    type="checkbox"
                    checked={props.settings.generationEnabled.generateVideo}
                    onChange={() =>
                      props.setSettings({
                        ...props.settings!,
                        generationEnabled: {
                          ...props.settings!.generationEnabled,
                          generateVideo:
                            !props.settings!.generationEnabled.generateVideo,
                        },
                      })
                    }
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
          )}
        </>
      )}
      {!props.settings && (
        <div className="panel-subtle empty-state">
          <p>
            {t("Settings are not available yet.", "Chưa có cài đặt khả dụng.")}
            {props.settingsLoadError ? ` ${props.settingsLoadError}` : ""}
          </p>
          <button
            className="btn"
            onClick={props.onRetryLoad}
            disabled={props.busy}
          >
            {t("Retry Loading Settings", "Tải lại cài đặt")}
          </button>
        </div>
      )}
    </section>
  );
}
