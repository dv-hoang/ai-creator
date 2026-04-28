import type { AssetRecord, TranscriptRow } from "@shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { HoverCopyTextarea } from "./HoverCopyTextarea";

export function TranscriptView(props: {
  transcripts: TranscriptRow[];
  untimedTranscript: string;
  generateSpeed: number;
  onChangeGenerateSpeed: (next: number) => void;
  onCopyUntimedTranscript: () => void;
  onExportSrt: () => void;
  onGenerateSpeechSceneByScene: () => void;
  onGenerateSpeechAllInOne: () => void;
  generatingSpeech: boolean;
  generatingSpeechScene: number | null;
  onUpdateRow: (
    transcriptId: string,
    patch: {
      speaker?: string;
      text?: string;
      startSec?: number;
      endSec?: number;
      voiceId?: string;
    },
  ) => void;
  onUpdateSpeakerVoice: (speaker: string, voiceId: string) => void;
  onGenerateSpeechForScene: (scene: number, speedOverride?: number) => void;
  speechAssets: AssetRecord[];
  toRenderableSrc: (filePath: string) => string;
  onDownloadSpeech: (assetId: string) => void;
  locale: "en" | "vi";
}) {
  const t = (en: string, vi: string) => (props.locale === "vi" ? vi : en);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        speaker: string;
        text: string;
        voiceId: string;
      }
    >
  >({});
  const rowById = useMemo(
    () => new Map(props.transcripts.map((row) => [row.id, row])),
    [props.transcripts],
  );
  const speakerVoiceMap = useMemo(() => {
    const map = new Map<string, string>();
    props.transcripts.forEach((row) => {
      const speaker = row.speaker.trim();
      if (!speaker || map.has(speaker)) return;
      map.set(speaker, row.voiceId ?? "");
    });
    return map;
  }, [props.transcripts]);
  const [speakerVoiceDrafts, setSpeakerVoiceDrafts] = useState<
    Record<string, string>
  >({});
  const [sceneGenerateSpeedDrafts, setSceneGenerateSpeedDrafts] = useState<
    Record<number, number>
  >({});
  const autosaveTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >({});
  const draftsRef = useRef(drafts);
  const sceneSpeechMap = useMemo(() => {
    const map = new Map<number, AssetRecord>();
    props.speechAssets.forEach((asset) => {
      try {
        const parsed = JSON.parse(asset.metadataJson) as { scene?: number };
        const scene = parsed.scene;
        if (typeof scene !== "number") return;
        const existing = map.get(scene);
        if (!existing) {
          map.set(scene, asset);
          return;
        }
        if (
          new Date(asset.createdAt).getTime() >
          new Date(existing.createdAt).getTime()
        ) {
          map.set(scene, asset);
        }
      } catch {
        // ignore malformed metadata
      }
    });
    return map;
  }, [props.speechAssets]);
  const latestAllInOneSpeechAsset = useMemo<AssetRecord | null>(() => {
    let latest: AssetRecord | null = null;
    props.speechAssets.forEach((asset) => {
      try {
        const parsed = JSON.parse(asset.metadataJson) as { mode?: string };
        if (parsed.mode === "all-in-one") {
          if (!latest) {
            latest = asset;
            return;
          }
          if (
            new Date(asset.createdAt).getTime() >
            new Date(latest.createdAt).getTime()
          ) {
            latest = asset;
          }
        }
      } catch {
        // ignore malformed metadata
      }
    });
    return latest;
  }, [props.speechAssets]);
  const scenes = useMemo(
    () =>
      [...new Set(props.transcripts.map((row) => row.scene))].sort(
        (a, b) => a - b,
      ),
    [props.transcripts],
  );

  function currentDraft(row: TranscriptRow) {
    return (
      drafts[row.id] ?? {
        speaker: row.speaker,
        text: row.text,
        voiceId: row.voiceId ?? "",
      }
    );
  }

  function setDraftValue(
    row: TranscriptRow,
    key: "speaker" | "text",
    value: string,
  ) {
    const base = currentDraft(row);
    setDrafts((previous) => ({
      ...previous,
      [row.id]: {
        ...base,
        [key]: value,
      },
    }));
  }

  function getSceneGenerateSpeed(scene: number): number {
    const draft = sceneGenerateSpeedDrafts[scene];
    if (Number.isFinite(draft)) {
      return Math.min(4, Math.max(0.25, draft));
    }
    return props.generateSpeed;
  }

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    Object.entries(drafts).forEach(([rowId, draft]) => {
      const row = rowById.get(rowId);
      if (!row) return;
      const changed = draft.speaker !== row.speaker || draft.text !== row.text;
      const existingTimer = autosaveTimersRef.current[rowId];
      if (!changed) {
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          autosaveTimersRef.current[rowId] = undefined;
        }
        return;
      }
      if (existingTimer) return;
      autosaveTimersRef.current[rowId] = setTimeout(() => {
        const latestRow = rowById.get(rowId);
        if (!latestRow) {
          autosaveTimersRef.current[rowId] = undefined;
          return;
        }
        const latestDraft = draftsRef.current[rowId];
        if (!latestDraft) {
          autosaveTimersRef.current[rowId] = undefined;
          return;
        }
        const stillChanged =
          latestDraft.speaker !== latestRow.speaker ||
          latestDraft.text !== latestRow.text;
        if (stillChanged) {
          props.onUpdateRow(rowId, {
            speaker: latestDraft.speaker,
            text: latestDraft.text,
          });
        }
        autosaveTimersRef.current[rowId] = undefined;
      }, 500);
    });
  }, [drafts, props, rowById]);

  useEffect(() => {
    return () => {
      Object.values(autosaveTimersRef.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer);
      });
    };
  }, []);

  return (
    <div className="transcript-view panel-subtle">
      <div className="inline-row">
        <h3>{t("Transcript", "Lời thoại")}</h3>
        <label className="inline-row" style={{ gap: 6 }}>
          <span className="muted">{t("Generate speed", "Tốc độ tạo")}</span>
          <input
            type="number"
            step={0.05}
            min={0.25}
            max={4}
            value={props.generateSpeed}
            onChange={(event) =>
              props.onChangeGenerateSpeed(
                Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : props.generateSpeed,
              )
            }
            style={{ width: 90 }}
            aria-label={t("Generate speed", "Tốc độ tạo")}
            title={t(
              "Speech speed multiplier (1.0 = default).",
              "Hệ số tốc độ giọng đọc (1.0 = mặc định).",
            )}
          />
        </label>
        <button className="btn" onClick={() => void props.onExportSrt()}>
          {t("Export .srt", "Xuất .srt")}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => void props.onGenerateSpeechAllInOne()}
          disabled={props.generatingSpeech}
        >
          {props.generatingSpeech
            ? t("Generating...", "Đang tạo...")
            : t("Generate Speech", "Tạo giọng đọc")}
        </button>
      </div>
      <HoverCopyTextarea
        readOnly
        rows={8}
        value={props.untimedTranscript}
        onChange={() => {}}
        onCopy={props.onCopyUntimedTranscript}
        placeholder={t("Transcript is empty.", "Chưa có lời thoại.")}
      />
      <div>
        <strong>{t("Speaker Voice IDs", "Voice ID theo người nói")}</strong>
        <div className="table-like" style={{ marginTop: 8 }}>
          {[...speakerVoiceMap.entries()].map(([speaker, currentVoiceId]) => {
            const nextVoiceId =
              speakerVoiceDrafts[speaker] ?? currentVoiceId ?? "";
            return (
              <div
                key={speaker}
                className="table-row speaker-voice-row transcript-flat-row"
              >
                <span>{speaker}</span>
                <input
                  value={nextVoiceId}
                  placeholder={t(
                    "Voice ID (optional)",
                    "Voice ID (không bắt buộc)",
                  )}
                  onChange={(event) =>
                    setSpeakerVoiceDrafts((previous) => ({
                      ...previous,
                      [speaker]: event.target.value,
                    }))
                  }
                  aria-label={t("Voice ID", "Voice ID")}
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    props.onUpdateSpeakerVoice(speaker, nextVoiceId)
                  }
                  disabled={nextVoiceId === currentVoiceId}
                >
                  {t("Apply", "Áp dụng")}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="table-like">
        {scenes.map((scene) => {
          const rows = props.transcripts.filter((row) => row.scene === scene);
          const latestSpeechAsset = sceneSpeechMap.get(scene);
          return (
            <div
              key={`scene-${scene}`}
              className="panel-subtle p-2 transcript-scene-card"
            >
              <div className="transcript-scene-header">
                <strong>
                  {t("Scene", "Cảnh")} {scene}
                </strong>
                <div className="inline-row" style={{ gap: 8 }}>
                  <label className="inline-row" style={{ gap: 6 }}>
                    <span className="muted">{t("Speed", "Tốc độ")}</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0.25}
                      max={4}
                      value={getSceneGenerateSpeed(scene)}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        setSceneGenerateSpeedDrafts((previous) => ({
                          ...previous,
                          [scene]: Number.isFinite(value)
                            ? Math.min(4, Math.max(0.25, value))
                            : props.generateSpeed,
                        }));
                      }}
                      style={{ width: 90 }}
                      aria-label={t("Generate speed", "Tốc độ tạo")}
                    />
                  </label>
                  <button
                    className="btn btn-icon transcript-generate-scene-btn"
                    type="button"
                    onClick={() =>
                      props.onGenerateSpeechForScene(
                        scene,
                        getSceneGenerateSpeed(scene),
                      )
                    }
                    disabled={props.generatingSpeech}
                    aria-label={t("Generate Speech", "Tạo giọng đọc")}
                    title={t("Generate Speech", "Tạo giọng đọc")}
                  >
                    {props.generatingSpeechScene === scene ||
                    props.generatingSpeech
                      ? "…"
                      : "🔊"}
                  </button>
                </div>
              </div>
              {rows.map((row) => {
                const draft = currentDraft(row);
                return (
                  <div
                    key={row.id}
                    className="table-row transcript-edit-row transcript-flat-row"
                  >
                    <input
                      value={draft.speaker}
                      onChange={(event) =>
                        setDraftValue(row, "speaker", event.target.value)
                      }
                      aria-label={t("Speaker", "Người nói")}
                    />
                    <textarea
                      rows={2}
                      value={draft.text}
                      onChange={(event) =>
                        setDraftValue(row, "text", event.target.value)
                      }
                      aria-label={t("Transcript text", "Nội dung lời thoại")}
                    />
                  </div>
                );
              })}
              {latestSpeechAsset && (
                <div style={{ marginTop: 8 }}>
                  <audio
                    controls
                    preload="metadata"
                    src={props.toRenderableSrc(latestSpeechAsset.filePath)}
                    style={{ width: "100%" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(() => {
        const latest = latestAllInOneSpeechAsset;
        if (!latest) return null;
        return (
          <div className="panel-subtle p-2" style={{ marginTop: 12 }}>
            <strong>
              {t("All in one speech", "Giọng đọc tất cả trong một")}
            </strong>
            <div className="table-like" style={{ marginTop: 8 }}>
              <div key={latest.id} className="table-row">
                <span>{t("Latest full transcript", "Bản toàn bộ mới nhất")}</span>
                <audio
                  controls
                  preload="metadata"
                  src={props.toRenderableSrc(latest.filePath)}
                  style={{ width: "100%" }}
                />
                <button
                  className="btn btn-icon"
                  type="button"
                  onClick={() => props.onDownloadSpeech(latest.id)}
                  aria-label={t("Download speech", "Tải giọng đọc")}
                  title={t("Download speech", "Tải giọng đọc")}
                >
                  ⬇
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
