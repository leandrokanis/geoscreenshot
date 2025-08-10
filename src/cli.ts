#!/usr/bin/env bun
"use strict";

import { resolve } from "node:path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import https from "node:https";
import dotenv from "dotenv";
import { captureStreetViewWithBrowser } from "./browser";

type Coordinates = {
  lat: number;
  lng: number;
  heading?: number;
  pitch?: number;
  fov?: number;
  size?: string;
};

type StreetViewParams = {
  key: string;
  radius?: number;
  source?: string;
  size?: string;
  scale?: number;
  heading?: number;
  pitch?: number;
  fov?: number;
};

type RequestedImageSize = {
  width: number;
  height: number;
};

let sharpModule: typeof import("sharp") | null = null;
async function getSharpOrThrow(): Promise<typeof import("sharp")> {
  if (sharpModule) return sharpModule;
  try {
    const mod = await import("sharp");
    sharpModule = mod.default ?? (mod as unknown as typeof import("sharp"));
    return sharpModule;
  } catch {
    exitWithError(
      "Image processing requires 'sharp'. Ensure it's installed and compatible with your runtime."
    );
  }
}

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): Record<string, unknown> & { _: string[] } {
  const args: Record<string, unknown> & { _: string[] } = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i] as string;
    if (part.startsWith("--")) {
      const [optRaw, value] = part.split("=");
      const opt = optRaw ?? "";
      const normalizedKey = opt.replace(/^--/, "");
      (args as Record<string, unknown>)[normalizedKey] = value === undefined ? true : value;
    } else {
      args._.push(part);
    }
  }
  return args;
}

function validateLatLng(latString: unknown, lngString: unknown): { lat: number; lng: number } {
  const lat = Number(latString);
  const lng = Number(lngString);
  const isLatValid = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isLngValid = Number.isFinite(lng) && lng >= -180 && lng <= 180;
  if (!isLatValid || !isLngValid) {
    exitWithError("Invalid coordinates. Use --lat and --lng within valid ranges.");
  }
  return { lat, lng };
}

function parseMapFile(filePath: string): Coordinates[] {
  let content: string;
  try {
    content = readFileSync(filePath, { encoding: "utf8" });
  } catch {
    exitWithError(`Cannot read map file at ${filePath}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    exitWithError("Invalid JSON in map file");
  }
  if (!Array.isArray(data)) {
    exitWithError("Map file must be an array of coordinates");
  }
  const asCoordinates = (item: unknown): Coordinates | null => {
    if (Array.isArray(item) && item.length >= 2) {
      const { lat, lng } = validateLatLng(item[0], item[1]);
      return { lat, lng };
    }
    if (item && typeof item === "object" && "lat" in item && "lng" in item) {
      const anyItem = item as Record<string, unknown>;
      const { lat, lng } = validateLatLng(anyItem.lat, anyItem.lng);
      const enriched: Coordinates = { lat, lng };
      if (anyItem.heading != null) enriched.heading = Number(anyItem.heading);
      if (anyItem.pitch != null) enriched.pitch = Number(anyItem.pitch);
      if (anyItem.fov != null) enriched.fov = Number(anyItem.fov);
      if (anyItem.size != null && typeof anyItem.size === "string") enriched.size = anyItem.size;
      return enriched;
    }
    return null;
  };
  const coords = (data as unknown[]).map(asCoordinates).filter((c): c is Coordinates => c != null);
  if (coords.length === 0) {
    exitWithError("Map file contains no valid coordinates");
  }
  return coords;
}

function httpGet(url: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    https
      .get(url, (res) => {
        const { statusCode } = res;
        if (statusCode && statusCode >= 400) {
          rejectPromise(new Error(`Request failed with status ${statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolvePromise(Buffer.concat(chunks)));
      })
      .on("error", rejectPromise);
  });
}

function buildMetadataUrl({ lat, lng }: { lat: number; lng: number }, params: StreetViewParams): string {
  const base = "https://maps.googleapis.com/maps/api/streetview/metadata";
  const search = new URLSearchParams({
    location: `${lat},${lng}`,
    key: params.key,
    radius: String(params.radius ?? 100),
    source: params.source || "outdoor",
  });
  return `${base}?${search.toString()}`;
}

function buildImageUrl({ lat, lng }: { lat: number; lng: number }, params: StreetViewParams): string {
  const base = "https://maps.googleapis.com/maps/api/streetview";
  const search = new URLSearchParams({
    location: `${lat},${lng}`,
    key: params.key,
    size: params.size || "1280x720",
    scale: String(params.scale ?? 2),
    fov: String(params.fov ?? 90),
    pitch: String(params.pitch ?? 0),
    heading: String(params.heading ?? 0),
    radius: String(params.radius ?? 100),
    source: params.source || "outdoor",
  });
  return `${base}?${search.toString()}`;
}

async function ensureMetadataAvailable(coords: { lat: number; lng: number }, params: StreetViewParams) {
  const url = buildMetadataUrl(coords, params);
  const buffer = await httpGet(url);
  const data = JSON.parse(buffer.toString("utf8")) as { status?: string; error_message?: string };
  if (data.status !== "OK") {
    exitWithError(`No Street View available: ${data.status ?? "UNKNOWN"}${data.error_message ? ` - ${data.error_message}` : ""}`);
  }
  return data;
}

async function downloadImage(url: string): Promise<Buffer> {
  return httpGet(url);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parseSize(input: string | undefined, fallback: RequestedImageSize): RequestedImageSize {
  if (!input) return fallback;
  const [w, h] = String(input).split("x");
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
  return { width, height };
}

function computeEffectiveScale(requested: RequestedImageSize, scaleArg: number | undefined): 1 | 2 {
  const candidate = Number.isFinite(scaleArg) ? Number(scaleArg) : requested.width > 640 || requested.height > 640 ? 2 : 1;
  return candidate === 1 ? 1 : 2;
}

function computeLogicalSize(requested: RequestedImageSize, scale: 1 | 2, cap = 640): RequestedImageSize {
  let logicalWidth = Math.floor(requested.width / scale);
  let logicalHeight = Math.floor(requested.height / scale);
  if (logicalWidth > cap || logicalHeight > cap) {
    const ratio = Math.min(cap / logicalWidth, cap / logicalHeight);
    logicalWidth = Math.floor(logicalWidth * ratio);
    logicalHeight = Math.floor(logicalHeight * ratio);
  }
  return {
    width: Math.max(1, logicalWidth),
    height: Math.max(1, logicalHeight),
  };
}

function shuffleIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = tmp;
  }
  return indices;
}

function buildBaseName(prefix: string | null, coords: Coordinates, index: number): string {
  return prefix ? `${prefix}_${index}` : `${coords.lat}_${coords.lng}_${Date.now()}`;
}

function resolveAngle(value: unknown, fallback: number): number {
  return value != null ? Number(value) : fallback;
}

async function createImageWithApi(
  coords: Coordinates,
  options: {
    apiKey: string;
    requested: RequestedImageSize;
    scaleArg?: number;
    heading: number;
    pitch: number;
    fov: number;
    radius: number;
    source: string;
    fit: "cover" | "contain" | "fill" | "inside" | "outside";
    verbose: boolean;
  }
): Promise<Buffer> {
  await ensureMetadataAvailable(coords, { key: options.apiKey, radius: options.radius, source: options.source });
  const effectiveScale = computeEffectiveScale(options.requested, options.scaleArg);
  const logical = computeLogicalSize(options.requested, effectiveScale);
  const normalizedSize = `${logical.width}x${logical.height}`;
  if (options.verbose) {
    console.log(
      `coords=${coords.lat},${coords.lng} size=${normalizedSize} scale=${effectiveScale} heading=${options.heading}`
    );
  }
  const imageUrl = buildImageUrl(
    { lat: coords.lat, lng: coords.lng },
    {
      key: options.apiKey,
      size: normalizedSize,
      scale: effectiveScale,
      heading: options.heading,
      pitch: options.pitch,
      fov: options.fov,
      radius: options.radius,
      source: options.source,
    }
  );
  const raw = await downloadImage(imageUrl);
  if (options.requested.width > 0 && options.requested.height > 0) {
    const sharp = await getSharpOrThrow();
    return await sharp(raw)
      .resize(options.requested.width, options.requested.height, { fit: options.fit })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
  return raw;
}

async function main() {
  const args = parseArgs(process.argv as unknown as string[]);
  dotenv.config();
  if (args.env) {
    dotenv.config({ path: resolve(String(args.env)), override: true });
  }
  const key = (args.key as string | undefined) || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    exitWithError("Missing API key. Provide --key or set GOOGLE_MAPS_API_KEY env var.");
  }
  const apiKey: string = key;

  const mapPath = args.map ? resolve(String(args.map)) : resolve(process.cwd(), "map.json");
  const allCoords = parseMapFile(mapPath);
  const count = args.count != null ? Math.max(1, Number(args.count)) : 2;

  const size = (args.size as string) || "1920x1080";
  const scale = args.scale != null ? Number(args.scale) : 2;
  const verbose = Boolean(args.verbose);
  const heading = args.heading != null ? Number(args.heading) : 0;
  const pitch = args.pitch != null ? Number(args.pitch) : 0;
  const fov = args.fov != null ? Number(args.fov) : 90;
  const radius = args.radius != null ? Number(args.radius) : 100;
  const source = (args.source as string) || "outdoor";
  const outputDir = args.out ? resolve(String(args.out)) : resolve(process.cwd(), "screenshots");
  const namePrefix = (args.name as string | null) || null;
  const fit = (args.fit as "cover" | "contain" | "fill" | "inside" | "outside") || "cover";

  const indices = shuffleIndices(allCoords.length);

  const outputs: string[] = [];
  ensureDir(outputDir);
  let successes = 0;
  for (const idx of indices) {
    if (successes >= count) break;
    const coords = allCoords[idx] as Coordinates | undefined;
    if (!coords) continue;
    const requested = parseSize(coords.size || size, { width: 1920, height: 1080 });
    try {
      const headingValue = resolveAngle(coords.heading, heading);
      const pitchValue = resolveAngle(coords.pitch, pitch);
      const fovValue = resolveAngle(coords.fov, fov);

      const image: Buffer = (args.mode as string) === "browser"
        ? await captureStreetViewWithBrowser(
            { lat: coords.lat, lng: coords.lng },
            {
              width: requested.width,
              height: requested.height,
              heading: headingValue,
              pitch: pitchValue,
              fov: fovValue,
              key: apiKey,
              useEmbed: true,
            }
          )
        : await createImageWithApi(coords, {
            apiKey,
            requested,
            scaleArg: Number.isFinite(scale) ? Number(scale) : undefined,
            heading: headingValue,
            pitch: pitchValue,
            fov: fovValue,
            radius,
            source,
            fit,
            verbose,
          });

      const baseName = buildBaseName(namePrefix, coords, successes + 1);
      const outputPath = resolve(outputDir, `${baseName}.jpg`);
      writeFileSync(outputPath, image);
      outputs.push(outputPath);
      successes += 1;
    } catch (err) {
      if (verbose) {
        const message = (err as { message?: string })?.message || String(err);
        console.error(`Skipping index ${idx}: ${message}`);
      }
    }
  }

  if (successes < count) {
    exitWithError(`Only generated ${successes} of ${count} images due to unavailable Street View or errors.`);
  }
  for (const p of outputs) console.log(p);
}

main().catch((err: unknown) => {
  exitWithError((err as { message?: string })?.message || String(err));
});


