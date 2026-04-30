import { z } from 'zod';

const shotSizeEnum = z.enum(['WS', 'MS', 'CU', 'ECU', 'FS']);

export const step1Schema = z.object({
  logline: z.string().min(1).optional(),
  theme: z.string().min(1).optional(),
  characters: z.array(
    z.object({
      name: z.string().min(1),
      prompt: z.string().min(1),
      negative_consistency: z.string().min(1).optional(),
    }),
  ),
  transcript: z.array(
    z.object({
      scene: z.number(),
      speaker: z.string().min(1),
      text: z.string().min(1),
      start_sec: z.number(),
      end_sec: z.number(),
    }),
  ),
  scenes: z.array(
    z.object({
      scene: z.number(),
      title: z.string().min(1),
      summary: z.string().min(1),
      characters_present: z.array(z.string()),
      environment: z.string().min(1),
      tone: z.string().min(1),
      key_action: z.string().min(1),
      camera_and_framing: z.string().min(1),
      clip_duration_sec: z.number().positive(),
      image_prompt: z.string().min(1),
      image_to_video_prompt: z.string().min(1),
      shot_size: shotSizeEnum.optional(),
      ambient_sound: z.string().optional(),
      sound_effect: z.string().optional(),
      dialogue_cue: z.string().optional(),
      end_frame_prompt: z.string().optional(),
      needs_end_frame: z.boolean().optional(),
    }),
  ),
});
