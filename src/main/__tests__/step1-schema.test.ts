import { describe, expect, test } from 'vitest';
import { step1Schema } from '../schemas';

describe('step1Schema', () => {
  test('parses minimal valid Step 1 payload', () => {
    const parsed = step1Schema.parse({
      characters: [{ name: 'A', prompt: 'prompt a' }],
      transcript: [
        { scene: 1, speaker: 'Narrator', text: 'Hello', start_sec: 0, end_sec: 0 },
      ],
      scenes: [
        {
          scene: 1,
          title: 'T',
          summary: 'S',
          characters_present: ['A'],
          environment: 'E',
          tone: 'calm',
          key_action: 'walk',
          camera_and_framing: 'WS',
          clip_duration_sec: 4,
          image_prompt: 'a cat',
          image_to_video_prompt: '+ 0–4s: walks',
        },
      ],
    });
    expect(parsed.characters[0].name).toBe('A');
  });

  test('parses extended optional fields', () => {
    const parsed = step1Schema.parse({
      logline: 'A hero returns.',
      theme: 'Belonging',
      characters: [
        {
          name: 'A',
          prompt: 'prompt a',
          negative_consistency: 'blue coat, round glasses',
        },
      ],
      transcript: [
        { scene: 1, speaker: 'Narrator', text: 'Hello', start_sec: 0, end_sec: 0 },
      ],
      scenes: [
        {
          scene: 1,
          title: 'T',
          summary: 'S',
          characters_present: ['A'],
          environment: 'E',
          tone: 'calm',
          key_action: 'walk',
          camera_and_framing: 'MS low angle',
          clip_duration_sec: 5,
          image_prompt: 'a cat',
          image_to_video_prompt: '+ 0–5s: walks',
          shot_size: 'MS',
          ambient_sound: 'rain',
          sound_effect: 'thunder',
          dialogue_cue: 'A speaks softly',
          needs_end_frame: true,
          end_frame_prompt: 'same cat sitting, rain stopped',
        },
      ],
    });
    expect(parsed.logline).toContain('hero');
    expect(parsed.scenes[0].shot_size).toBe('MS');
    expect(parsed.scenes[0].needs_end_frame).toBe(true);
  });

  test('rejects invalid shot_size', () => {
    expect(() =>
      step1Schema.parse({
        characters: [{ name: 'A', prompt: 'p' }],
        transcript: [
          { scene: 1, speaker: 'N', text: 't', start_sec: 0, end_sec: 0 },
        ],
        scenes: [
          {
            scene: 1,
            title: 'T',
            summary: 'S',
            characters_present: [],
            environment: 'E',
            tone: 't',
            key_action: 'k',
            camera_and_framing: 'c',
            clip_duration_sec: 3,
            image_prompt: 'i',
            image_to_video_prompt: 'v',
            shot_size: 'INVALID',
          },
        ],
      }),
    ).toThrow();
  });
});
