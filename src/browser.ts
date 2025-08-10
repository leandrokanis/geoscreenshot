"use strict";

import puppeteer from "puppeteer";
import { setTimeout as sleep } from "node:timers/promises";

type Coords = { lat: number; lng: number };
type BrowserParams = {
  width: number;
  height: number;
  key?: string;
  heading?: number;
  pitch?: number;
  fov?: number;
  useEmbed?: boolean;
};

function buildMapsPanoUrl({ lat, lng }: Coords, params: BrowserParams): string {
  const base = "https://www.google.com/maps/@";
  const search = new URLSearchParams({
    api: "1",
    map_action: "pano",
    viewpoint: `${lat},${lng}`,
  });
  if (params.heading != null) search.set("heading", String(params.heading));
  if (params.pitch != null) search.set("pitch", String(params.pitch));
  if (params.fov != null) search.set("fov", String(params.fov));
  return `${base}?${search.toString()}`;
}

function buildEmbedStreetViewUrl({ lat, lng }: Coords, params: BrowserParams): string {
  const base = "https://www.google.com/maps/embed/v1/streetview";
  const search = new URLSearchParams({
    key: String(params.key ?? ""),
    location: `${lat},${lng}`,
  });
  if (params.heading != null) search.set("heading", String(params.heading));
  if (params.pitch != null) search.set("pitch", String(params.pitch));
  if (params.fov != null) search.set("fov", String(params.fov));
  return `${base}?${search.toString()}`;
}

async function tryClickConsent(page: import("puppeteer").Page) {
  const candidates = [
    'button[aria-label="Accept all"]',
    'button[aria-label="Aceitar tudo"]',
    'button:has-text("Aceitar tudo")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Aceitar")',
  ];
  for (const sel of candidates) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await sleep(500);
        return;
      }
    } catch {}
  }
  try {
    const buttons = await page.$$("button");
    for (const b of buttons) {
      const txt = (await page.evaluate((el) => el.textContent || "", b)).trim();
      if (/accept|aceitar|agree/i.test(txt)) {
        await b.click();
        await sleep(500);
        return;
      }
    }
  } catch {}
}

export async function captureStreetViewWithBrowser(
  coords: Coords,
  params: BrowserParams
): Promise<Buffer> {
  const viewportWidth = params.width;
  const viewportHeight = params.height;
  const url = params.useEmbed && params.key ? buildEmbedStreetViewUrl(coords, params) : buildMapsPanoUrl(coords, params);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    if (!params.useEmbed) {
      await tryClickConsent(page);
      await sleep(1500);
      try {
        await page.waitForSelector("canvas", { timeout: 15000 });
      } catch {}
    } else {
      await sleep(1500);
    }
    const buffer = await page.screenshot({ type: "jpeg", quality: 90 });
    return buffer as Buffer;
  } finally {
    await browser.close();
  }
}


