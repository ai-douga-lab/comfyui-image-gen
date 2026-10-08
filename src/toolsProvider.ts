import { tool, type ToolsProviderController } from "@lmstudio/sdk";
import { existsSync } from "fs";
import { copyFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { ASPECTS, MAX_REFERENCE_IMAGES, runComfy } from "./comfy";
import { globalConfigSchematics } from "./config";
import { loadMedia, mediaDir, saveMedia } from "./media";

const LABEL_RE = /\[([av]\d+)\]/g;

/** yyyyMMdd_HHmmss in local time. */
function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Pick `${base}.png`, or `${base}_2.png`, `${base}_3.png`, ... so an existing file is never overwritten. */
function uniqueName(dir: string, base: string): string {
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base}_image`;
  let name = `${base}.png`;
  for (let i = 2; existsSync(join(dir, name)); i++) name = `${base}_${i}.png`;
  return name;
}

/**
 * File name for the image shown in the chat, e.g. "apple_banana_watermelon.png".
 * LM Studio only renders local images whose names are plain ASCII, so only letters, digits, "_" and
 * "-" are kept. Falls back to a timestamp when nothing usable is left.
 */
function chatFileName(dir: string, fileName: string | undefined): string {
  const base = (fileName ?? "")
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 60);
  return uniqueName(dir, base || `image_${timestamp()}`);
}

/**
 * File name for the copy saved to the export folder, in the user's language, e.g.
 * "りんごとバナナの画像.png". Removes only the characters Windows does not allow.
 */
function exportFileName(dir: string, title: string | undefined): string {
  const base = (title ?? "")
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
  return uniqueName(dir, base || `image_${timestamp()}`);
}

export async function toolsProvider(ctl: ToolsProviderController) {
  const generateImage = tool({
    name: "generate_image",
    description:
      "Generate an image with Qwen Image 2.1 on the user's local ComfyUI. " +
      "The new image is shown to you after the call, labeled [v1], [v2], ... " +
      "To use existing images as references, write their labels in the prompt, e.g. " +
      '"The woman from [a1] wearing the dress from [v2], standing in a garden." ' +
      "Only labels that appear in this conversation can be used. " +
      "To edit or vary an existing image (e.g. 'cut this apple in half'), you MUST put its label in the prompt; " +
      "'this image' means the most recent image. " +
      "Always set title (in the user's language) and file_name (short English, e.g. apple_banana_watermelon).",
    parameters: {
      prompt: z
        .string()
        .describe(
          "English only. One detailed paragraph describing the finished image as an observer: " +
            "subject, position in the frame, materials, colors, lighting, overall mood. " +
            "Refer to reference images by their labels such as [a1] or [v1].",
        ),
      aspect_ratio: z
        .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"])
        .optional()
        .describe("Output shape. Omit unless the user asked for portrait, landscape or square."),
      megapixels: z
        .number()
        .min(0.2)
        .max(4)
        .optional()
        .describe(
          "Output size in megapixels. Omit unless the user explicitly asks for a bigger or smaller image " +
            "(the default comes from the plugin settings). Up to 4.0 for 2K.",
        ),
      seed: z.number().int().optional().describe("Omit for a new random image."),
      title: z
        .string()
        .optional()
        .describe("Short title of the image in the user's language (e.g. りんごとバナナの画像)."),
      file_name: z
        .string()
        .optional()
        .describe(
          "Short file name in English: lowercase words joined with underscores, no extension " +
            "(e.g. apple_banana_watermelon).",
        ),
    },
    implementation: async (
      { prompt, aspect_ratio, megapixels, seed, title, file_name },
      { status, signal },
    ) => {
      const config = ctl.getGlobalPluginConfig(globalConfigSchematics);
      const dir = mediaDir(ctl);
      const media = await loadMedia(dir);

      // 0. Images attached to the user's message are always used, even if the model forgot to write
      //    their labels: add the missing ones to the beginning of the prompt.
      let autoAdded: string[] = [];
      if (config.get("autoAttachRefs")) {
        autoAdded = media.turnAttachments.filter(
          l => media.attachments[l] && !new RegExp(`\\[${l}\\]`).test(prompt),
        );
        if (autoAdded.length) {
          const list = autoAdded.map(l => `[${l}]`).join(" and ");
          prompt = `Using ${list} as reference image${autoAdded.length > 1 ? "s" : ""}: ${prompt}`;
        }
      }

      // 1. Collect the labels used in the prompt, in order of first appearance.
      const labels: string[] = [];
      for (const m of prompt.matchAll(LABEL_RE)) {
        if (!labels.includes(m[1])) labels.push(m[1]);
      }
      const available = [...Object.keys(media.attachments), ...Object.keys(media.variants)];
      const unknown = labels.filter(l => !(media.attachments[l] ?? media.variants[l]));
      if (unknown.length) {
        return (
          `Error: unknown image label(s): ${unknown.map(l => `[${l}]`).join(", ")}. ` +
          `Available labels: ${available.length ? available.map(l => `[${l}]`).join(", ") : "none"}. ` +
          "Fix the prompt and call generate_image again."
        );
      }
      if (labels.length > MAX_REFERENCE_IMAGES) {
        return `Error: at most ${MAX_REFERENCE_IMAGES} reference images can be used (got ${labels.length}).`;
      }

      // 2. Assign input slots and rewrite labels into the image model's reference syntax.
      const refFormat = config.get("refFormat") || "<image{n}>";
      const references = labels.map(l => media.attachments[l] ?? media.variants[l]);
      const modelPrompt = prompt.replace(LABEL_RE, (whole, label: string) => {
        const idx = labels.indexOf(label);
        return idx >= 0 ? refFormat.replace("{n}", String(idx + 1)) : whole;
      });

      const usedSeed = seed ?? Math.floor(Math.random() * 2 ** 48);
      const aspect = aspect_ratio ?? "9:16";
      // Size: the model's value only when the user asked for one, otherwise the plugin setting.
      const usedMegapixels = megapixels ?? (config.get("outputMegapixels") || 0.5);

      // 3. Run ComfyUI.
      let images: Buffer[];
      try {
        images = await runComfy({
          comfyUrl: config.get("comfyUrl") || "http://127.0.0.1:8188",
          workflowPath: config.get("workflowPath"),
          prompt: modelPrompt,
          references,
          aspectRatio: aspect in ASPECTS ? aspect : "9:16",
          megapixels: usedMegapixels,
          seed: usedSeed,
          signal,
          status,
        });
      } catch (e) {
        if (signal.aborted) {
          return "Cancelled: the user stopped the generation, and the ComfyUI job was cancelled.";
        }
        const msg = e instanceof Error ? e.message : String(e);
        if (/fetch failed|ECONNREFUSED/i.test(msg)) {
          return "Error: cannot connect to ComfyUI. Tell the user to check that ComfyUI is running.";
        }
        return `Error: ${msg}`;
      }
      if (images.length === 0) return "Error: ComfyUI finished but returned no image.";

      // 4. Save as v1, v2, ... in the chat's working directory and register them.
      const latest = await loadMedia(dir); // re-read: the table may have changed while generating
      const newLabels: string[] = [];
      for (const img of images) {
        const n = Object.keys(latest.variants).length + 1;
        const label = `v${n}`;
        // The label (v1, v2, ...) is how the model refers to the image; the file name is for people.
        const file = join(dir, chatFileName(dir, file_name));
        await writeFile(file, img);
        latest.variants[label] = file;
        latest.info[label] = { refs: labels, ...(title ? { title } : {}) };
        newLabels.push(label);

        // Optional copy with a name in the user's language (e.g. りんごとバナナの画像.png).
        const exportDir = config.get("exportDir");
        if (exportDir) {
          try {
            await mkdir(exportDir, { recursive: true });
            await copyFile(file, join(exportDir, exportFileName(exportDir, title || file_name)));
          } catch (e) {
            console.error(`Failed to copy the image to ${exportDir}:`, e);
          }
        }
      }
      await saveMedia(dir, latest);

      return (
        `Generated ${newLabels.map(l => `[${l}]`).join(", ")} ` +
        `(aspect_ratio=${aspect}, megapixels=${usedMegapixels}, seed=${usedSeed}` +
        (labels.length ? `, references=${labels.map(l => `[${l}]`).join(", ")}` : "") +
        (autoAdded.length
          ? `; ${autoAdded.map(l => `[${l}]`).join(", ")} added automatically because the user attached them`
          : "") +
        "). The image is shown to you in the next message: look at it and tell the user how it turned out, in the user's language. " +
        `(comfy-gen: ${newLabels.join(", ")})`
      );
    },
  });

  return [generateImage];
}
