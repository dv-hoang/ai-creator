import type { AssetRecord, TranscriptRow } from "@shared/types";
import { useMemo, useState } from "react";

export function TranscriptView(props: {
  transcripts: TranscriptRow[];
  untimedTranscript: string;
  onExportSrt: () => void;
  onGenerateSpeechSceneByScene: () => void;
  onGenerateSpeechAllInOne: () => void;
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
  onGenerateSpeechForScene: (scene: number) => void;
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
  const sceneSpeechMap = useMemo(() => {
    const map = new Map<number, AssetRecord[]>();
    props.speechAssets.forEach((asset) => {
      try {
        const parsed = JSON.parse(asset.metadataJson) as { scene?: number };
        const scene = parsed.scene;
        if (typeof scene !== "number") return;
        const bucket = map.get(scene) ?? [];
        bucket.push(asset);
        map.set(scene, bucket);
      } catch {
        // ignore malformed metadata
      }
    });
    return map;
  }, [props.speechAssets]);
  const allInOneSpeechAssets = useMemo(() => {
    const items: AssetRecord[] = [];
    props.speechAssets.forEach((asset) => {
      try {
        const parsed = JSON.parse(asset.metadataJson) as { mode?: string };
        if (parsed.mode === "all-in-one") {
          items.push(asset);
        }
      } catch {
        // ignore malformed metadata
      }
    });
    return items;
  }, [props.speechAssets]);
  const scenes = useMemo(
    () => [...new Set(props.transcripts.map((row) => row.scene))].sort((a, b) => a - b),
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

  function hasChanges(row: TranscriptRow): boolean {
    const draft = currentDraft(row);
    return draft.speaker !== row.speaker || draft.text !== row.text;
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

  function saveRow(rowId: string) {
    const row = rowById.get(rowId);
    if (!row) return;
    const draft = currentDraft(row);
    props.onUpdateRow(rowId, {
      speaker: draft.speaker,
      text: draft.text,
    });
  }

  return (
    <div className="transcript-view panel-subtle">
      <div className="inline-row">
        <h3>{t("Transcript", "Lời thoại")}</h3>
        <button
          className="btn"
          onClick={() => void navigator.clipboard.writeText(props.untimedTranscript)}
        >
          {t("Copy Untimed Transcript", "Sao chép lời thoại không thời gian")}
        </button>
        <button className="btn" onClick={() => void props.onExportSrt()}>
          {t("Export .srt", "Xuất .srt")}
        </button>
        <details className="speech-dropdown">
          <summary className="btn speech-dropdown-trigger">
            <span>{t("Generate Speech", "Tạo giọng đọc")}</span>
            <span className="speech-dropdown-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="speech-dropdown-menu">
            <button
              className="btn speech-dropdown-item"
              type="button"
              onClick={() => void props.onGenerateSpeechSceneByScene()}
            >
              {t("Scene by Scene", "Theo từng cảnh")}
            </button>
            <button
              className="btn speech-dropdown-item"
              type="button"
              onClick={() => void props.onGenerateSpeechAllInOne()}
            >
              {t("All in one", "Tất cả trong một")}
            </button>
          </div>
        </details>
      </div>
      <textarea readOnly rows={8} value={props.untimedTranscript} />
      <div className="panel-subtle p-2">
        <strong>{t("Speaker Voice IDs", "Voice ID theo người nói")}</strong>
        <div className="table-like" style={{ marginTop: 8 }}>
          {[...speakerVoiceMap.entries()].map(([speaker, currentVoiceId]) => {
            const nextVoiceId =
              speakerVoiceDrafts[speaker] ?? currentVoiceId ?? "";
            return (
              <div key={speaker} className="table-row speaker-voice-row">
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
          const speechAssets = sceneSpeechMap.get(scene) ?? [];
          return (
            <div key={`scene-${scene}`} className="panel-subtle p-2">
              <div className="inline-row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {t("Scene", "Cảnh")} {scene}
                </strong>
                <button
                  className="btn"
                  type="button"
                  onClick={() => props.onGenerateSpeechForScene(scene)}
                >
                  {t("Generate Speech", "Tạo giọng đọc")}
                </button>
              </div>
              {rows.map((row) => {
                const draft = currentDraft(row);
                return (
                  <div key={row.id} className="table-row transcript-edit-row">
                    <span>
                      {t("Scene", "Cảnh")} {row.scene}
                    </span>
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
                      onChange={(event) => setDraftValue(row, "text", event.target.value)}
                      aria-label={t("Transcript text", "Nội dung lời thoại")}
                    />
                    <button
                      className="btn transcript-row-save-btn"
                      type="button"
                      onClick={() => saveRow(row.id)}
                      disabled={!hasChanges(row)}
                    >
                      {t("Save", "Lưu")}
                    </button>
                  </div>
                );
              })}
              {speechAssets.length > 0 && (
                <div className="table-like" style={{ marginTop: 8 }}>
                  {speechAssets.map((asset) => {
                    let speakerLabel = "";
                    try {
                      const parsed = JSON.parse(asset.metadataJson) as {
                        speaker?: string;
                      };
                      speakerLabel = parsed.speaker?.trim() ?? "";
                    } catch {
                      // ignore malformed metadata
                    }
                    return (
                      <div key={asset.id} className="table-row">
                        <span>{speakerLabel || t("Speaker", "Người nói")}</span>
                        <audio
                          controls
                          preload="metadata"
                          src={props.toRenderableSrc(asset.filePath)}
                          style={{ width: "100%" }}
                        />
                        <button
                          className="btn btn-icon"
                          type="button"
                          onClick={() => props.onDownloadSpeech(asset.id)}
                          aria-label={t("Download speech", "Tải giọng đọc")}
                          title={t("Download speech", "Tải giọng đọc")}
                        >
                          ⬇
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {allInOneSpeechAssets.length > 0 && (
        <div className="panel-subtle p-2" style={{ marginTop: 12 }}>
          <strong>{t("All in one speech", "Giọng đọc tất cả trong một")}</strong>
          <div className="table-like" style={{ marginTop: 8 }}>
            {allInOneSpeechAssets.map((asset) => (
              <div key={asset.id} className="table-row">
                <span>{t("Full transcript", "Toàn bộ lời thoại")}</span>
                <audio
                  controls
                  preload="metadata"
                  src={props.toRenderableSrc(asset.filePath)}
                  style={{ width: "100%" }}
                />
                <button
                  className="btn btn-icon"
                  type="button"
                  onClick={() => props.onDownloadSpeech(asset.id)}
                  aria-label={t("Download speech", "Tải giọng đọc")}
                  title={t("Download speech", "Tải giọng đọc")}
                >
                  ⬇
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
