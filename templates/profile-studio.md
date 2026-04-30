### 🎯 PIPELINE GOALS & CONSTRAINTS (ANIMATION STUDIO PROFILE)

0. **Language Rules (CRITICAL):**
   - **Transcript language:** All `transcript[].text` MUST follow **LANGUAGE POLICY** (`{TRANSCRIPT_LANGUAGE_POLICY}`).
   - **Prompt language:** All image-generation prompts MUST be written in **PROMPT_LANGUAGE** (`{PROMPT_LANGUAGE}`):
     - `characters[].prompt`
     - `scenes[].image_prompt`
     - `scenes[].image_to_video_prompt`
   - If `{PROMPT_LANGUAGE}` is empty or "optional", use `{TRANSCRIPT_LANGUAGE_POLICY}` for prompts.

1. **Narrative shape:** Use a clear **three-act** arc (setup → confrontation → resolution). Pace for **emotional clarity**, not feed-algorithm tricks. Hooks may be subtle; avoid gimmicky “pattern interrupt” unless the story genuinely needs it.
2. **Continuity bible:** Keep names, wardrobe, age, signature props, and palette **strictly consistent** across every scene. `characters_present` must only list names that exist in `characters[]`.
3. **Motion-first scenes:** One scene = one coherent motion beat and one dominant camera intent. Use as many scenes as the story needs; do not pad or truncate artificially.
4. **Variable clip durations:** Natural `clip_duration_sec` per beat (dialogue may hold longer; action bursts may be shorter). No fixed duration template.
5. **Time-sliced I2V motion:** Every `image_to_video_prompt` must use **labeled time slices** from `0s` through `clip_duration_sec` with **no gaps or overlap**. Describe bodies, faces, props, cloth/hair, motivated **camera** movement (why the camera moves — reveal emotion, geography, or power), and smooth **handoffs** between slices so motion feels film-literate, not slideshow-like.
6. **Film grammar:** Use professional vocabulary in `camera_and_framing` and set optional `shot_size` (`WS` | `MS` | `CU` | `ECU` | `FS`) to match intent.
7. **Audio planning (optional fields):** Populate `ambient_sound`, `sound_effect`, and `dialogue_cue` when they clarify the beat (otherwise use short placeholders like `"none"`).
8. **Strict output:** Return exactly **one** valid JSON object. No markdown fences, preamble, or postscript.

---

### 🧩 GENERATION STEPS

**STEP 1: CHARACTER DESIGN BIBLE**
Lock each character to {VISUAL_STYLE} with repeatable silhouette, palette, and wardrobe. Each `prompt` is a **reference-sheet style** string: identity lock, multi-action coverage, multi-angle (0° / 45° / 90° / 180°, high/low), expression range, materials, and **no identity morphing**.
Add `negative_consistency` per character when possible: explicit “do not change” anchors (face shape, hair, outfit colors, key prop).

**STEP 2: SCRIPT & TRANSCRIPT**
Map dialogue and narration to visual beats. `start_sec` / `end_sec` stay `0` on transcript rows (the app derives timing from `clip_duration_sec`).

**STEP 3: SCENE DIRECTING**
For each scene: title, summary, environment, tone, `key_action`, `camera_and_framing`, optional `shot_size`, optional audio strings, `clip_duration_sec`, `image_prompt`, and `image_to_video_prompt` with **time-sliced** motion emphasizing **motivated camera** and seamless slice boundaries.

{OPTIONAL_END_FRAME_INSTRUCTIONS}
