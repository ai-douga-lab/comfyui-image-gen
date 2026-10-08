import { createHash } from "crypto";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { extname, join } from "path";
import { Jimp } from "jimp";

/*
 * Images sent to the chat model are shrunk to a pixel budget. Big images make the model's prompt
 * processing very slow (every image of the conversation is sent again on every turn), while the
 * model does not need full resolution to recognize what is in them. ComfyUI still gets the originals.
 */

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

let options = { maxMegapixels: 0.5, cacheDir: "" };

/** maxMegapixels <= 0 sends images unchanged. cacheDir keeps the shrunk copies between turns. */
export function setVisionOptions(o: { maxMegapixels: number; cacheDir: string }) {
  options = o;
}

const toUrl = (mime: string, data: Buffer) => `data:${mime};base64,${data.toString("base64")}`;

/** Read an image file and return it as a data URL for the OpenAI image_url part (shrunk if needed). */
export async function imageDataUrlForModel(path: string): Promise<string> {
  const data = await readFile(path);
  const original = () => toUrl(IMAGE_MIME[extname(path).toLowerCase()] ?? "image/png", data);
  const maxPixels = options.maxMegapixels * 1_000_000;
  if (!(maxPixels > 0)) return original();

  try {
    const st = await stat(path);
    const key = createHash("sha1").update(`${path}|${st.size}|${st.mtimeMs}|${maxPixels}`).digest("hex");
    const cached = options.cacheDir ? join(options.cacheDir, `${key}.jpg`) : "";
    if (cached) {
      try {
        return toUrl("image/jpeg", await readFile(cached));
      } catch {
        // not cached yet
      }
    }

    const img = await Jimp.fromBuffer(data);
    const { width, height } = img.bitmap;
    if (width * height <= maxPixels) return original();

    const scale = Math.sqrt(maxPixels / (width * height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    img.resize({ w, h });
    // JPEG has no transparency: put the image on white so transparent areas do not turn black.
    const canvas = new Jimp({ width: w, height: h, color: 0xffffffff });
    canvas.composite(img, 0, 0);
    const out = await canvas.getBuffer("image/jpeg", { quality: 85 });

    if (cached) {
      try {
        await mkdir(options.cacheDir, { recursive: true });
        await writeFile(cached, out);
      } catch (e) {
        console.warn("Could not cache the resized image:", e);
      }
    }
    return toUrl("image/jpeg", out);
  } catch (e) {
    // e.g. WebP, which the image library cannot decode: send the original.
    console.warn(`Could not resize ${path}; sending it unchanged.`, e instanceof Error ? e.message : e);
    return original();
  }
}
