import { z } from 'zod';

export const step1Schema = z.object({
  characters: z.array(
    z.object({
      name: z.string().min(1),
      prompt: z.string().min(1)
    })
  ),
  transcript: z.array(
    z.object({
      scene: z.number(),
      speaker: z.string().min(1),
      text: z.string().min(1),
      start_sec: z.number(),
      end_sec: z.number()
    })
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
      image_to_video_prompt: z.string().min(1)
    })
  )
});
