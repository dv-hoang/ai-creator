### 🎯 PIPELINE GOALS & CONSTRAINTS

0. **Language Rules (CRITICAL):**
   - **Transcript language:** All `transcript[].text` MUST follow **LANGUAGE POLICY** (`{TRANSCRIPT_LANGUAGE_POLICY}`).
   - **Prompt language:** All image-generation prompts MUST be written in **PROMPT_LANGUAGE** (`{PROMPT_LANGUAGE}`):
     - `characters[].prompt`
     - `scenes[].image_prompt`
     - `scenes[].image_to_video_prompt`
   - If `{PROMPT_LANGUAGE}` is empty or "optional", use `{TRANSCRIPT_LANGUAGE_POLICY}` for prompts.

1. **Organic, Motion-First Granularity:** Break the story down into as many micro-scenes as necessary to tell the complete narrative fully and fluidly. Do not artificially limit or cap the scene count. One scene = one coherent motion beat and one static camera angle.
2. **Variable Clip Durations:** Assign a natural `clip_duration_sec` per scene based on action complexity (e.g., 4.0s for quick reactions, 7.0s for dialogue, 12.0s for complex sweeping establishments). DO NOT use a fixed duration.
3. **Show, Don't Tell:** Translate narrative into highly visual, drawable moments. Ensure extra transition and reaction beats are given their own rows to pace the story naturally.
4. **Time-Sliced I2V Motion:** Every `image_to_video_prompt` must spell out **very detailed transforms** as consecutive time slices from `0s` through the scene’s `clip_duration_sec` (inclusive). Use a clear labeled list (e.g. lines starting with `+ 0–1s:`, `+ 1–3s:`, `+ 3–8s:` for an 8s clip). Each slice must describe concrete motion: bodies, faces, hands/props, cloth/hair, lighting shifts, and **camera** (pan, tilt, dolly, static). Slices must cover the full duration with no gaps or overlap.
5. **Short-Form Viral Optimization (TikTok / Facebook Reels / YouTube Shorts):**
   - Start with a **pattern interrupt hook** in the very first scene and first 1–2 seconds (surprise, tension, impossible visual, emotional question, or immediate payoff tease).
   - Maintain **high retention pacing**: frequent micro-beat shifts, clear visual progression, and no dead time.
   - Use a **curiosity loop** structure: setup → escalation → payoff → optional twist/callback.
   - Prefer scenes that are strong in **9:16 vertical framing readability** (clear subject silhouette, foreground action, high contrast focal point).
   - End with a strong final beat that feels **share-worthy** (emotional spike, unexpected reveal, satisfying payoff) without adding on-screen text.
6. **Strict Output:** You must return exactly ONE valid JSON object. No markdown wrapping outside the JSON, no preamble, no postscript.

---

### 🧩 GENERATION STEPS

**STEP 1: CHARACTER DESIGN BIBLE**
Design each character with highly specific, repeatable visual traits (hair color, exact clothing, body type) locked to the {VISUAL_STYLE}. This prevents identity drift across scenes.
For each character `prompt`, write it as a **reference-sheet prompt** (single long prompt string) that includes:
- **Identity lock:** face, body proportions, age range, hairstyle, outfit layers, color palette, accessories, materials.
- **Multi-motion set:** at least 6 distinct actions (idle, walk/run, turn, reach/use prop, emotional reaction, dynamic movement).
- **Multi-angle / degree coverage:** explicit angles such as front (0deg), 3/4 (45deg), side (90deg), back (180deg), high angle, low angle.
- **Expression range:** at least 5 facial/emotional states that still preserve identity.
- **Style and render constraints:** consistent {VISUAL_STYLE}, {ART_DIRECTION_HINT}, lighting logic, and no identity morphing.
- Optionally add `negative_consistency` per character: one short line listing features that must NOT change across scenes.

**STEP 2: SCRIPT & TRANSCRIPT PACING**
Break the narrative into a full 3-act structure. Map the dialogue/narration to the visual beats. Set `start_sec` and `end_sec` to `0` on each transcript row — the pipeline assigns segment lengths from each scene’s `clip_duration_sec` so SubRip/TTS slots match I2V clip timing.

**STEP 2.5: VIRAL HOOK BLUEPRINT (MANDATORY for this profile)**
- **Opening Hook:** Scene 1 must immediately create curiosity or emotional tension in the first 1–2s.
- **Retention Beats:** Every 2–5 seconds of timeline progression should introduce a noticeable visual change, conflict escalation, or new reveal.
- **Platform Fit:** Keep energy front-loaded and mobile-friendly; prioritize instantly readable action for short-form feeds.
- **Payoff:** Ensure the final scene resolves the hook promise (or subverts it with a coherent twist) to maximize completion and rewatch potential.

**STEP 3: SCENE-BY-SCENE DIRECTING (Stills + Motion)**
For EVERY scene required to complete the story arc, you must provide:

- **Cinematic Metadata:** Environment, tone, key action, and camera framing (e.g., Extreme Close-Up, Wide Shot, Over-the-shoulder).
- Optional **`shot_size`:** one of `WS`, `MS`, `CU`, `ECU`, `FS` matching the primary framing.
- Optional **audio layer** for production planning: `ambient_sound`, `sound_effect`, `dialogue_cue` (plain strings; may be empty if not applicable).
- **`image_prompt` (For Still Generation):** A dense, comma-separated prompt focusing on subject, action, framing, environment, lighting, and strictly enforcing the {VISUAL_STYLE} and {ART_DIRECTION_HINT}.
- **`image_to_video_prompt` (For I2V Generation):** A **time-sliced** motion script starting from the exact layout of the `image_prompt`. Subdivide `[0, clip_duration_sec]` into labeled bands and describe what transforms in each (see pipeline goal #4).
  - _Format (example for `clip_duration_sec` = 8):_  
    `+ 0–1s: …` (hook / micro-beat)  
    `+ 1–3s: …` (main action escalation)  
    `+ 3–8s: …` (resolve, settle, or handoff)  
    Adjust band count and boundaries to the story; **finer slices for complex clips** (e.g. 12s may use 4–6 bands).
  - _Syntax:_ Present continuous / imperative is fine; be specific (who moves, how fast, what the camera does each slice).
  - _Constraints:_ No on-screen text, no morphing identities, no new characters beyond the still.

{OPTIONAL_END_FRAME_INSTRUCTIONS}
