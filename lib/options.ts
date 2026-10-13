// Options partagées entre le formulaire et l'API : une seule liste, validée des deux côtés.

export const ENDPOINT = "fal-ai/trellis-2" as const;

export const RESOLUTIONS = ["512", "1024", "1536"] as const;
export const TEXTURE_SIZES = ["1024", "2048", "4096"] as const;
export const DECIMATIONS = [20_000, 50_000, 200_000, 500_000] as const;

export type Resolution = (typeof RESOLUTIONS)[number];
export type TextureSize = (typeof TEXTURE_SIZES)[number];

export type GenerateOptions = {
  resolution: Resolution;
  textureSize: TextureSize;
  decimationTarget: number;
  remesh: boolean;
  seed?: number;
};

export const DEFAULT_OPTIONS: GenerateOptions = {
  resolution: "1024",
  textureSize: "2048",
  decimationTarget: 200_000,
  remesh: true,
};

/** Taille maximale de l'image envoyée (Vercel refuse un corps de plus de 4,5 Mo). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type StatusResponse =
  | { status: "queued"; position?: number }
  | { status: "running"; logs: string[] }
  | { status: "done"; glbUrl: string; fileSize?: number }
  | { status: "error"; message: string };
