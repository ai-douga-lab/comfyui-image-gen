import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { basename } from "path";
// Bundled into the plugin at build time; used when no workflow file is configured.
// workflows/QI21_Ref2I.json is the same workflow in UI format, for opening and editing in ComfyUI.
import defaultWorkflow from "../workflows/QI21_Ref2I_api.json";

/*
 * Node IDs of workflows/QI21_Ref2I_api.json (ComfyUI "Export (API)").
 * If you rebuild the workflow and the IDs change, update them here.
 */
const NODE = {
  rawPrompt: "74", // PrimitiveStringMultiline "Raw Prompt"
  usePE: "76", // PrimitiveBoolean "Use PE"
  editImage1: "95", // PrimitiveBoolean "Edit image1" (start from image1 instead of an empty latent)
  resolution: "29", // ResolutionSelector
  batch: "56", // batch size
  seed: "7", // RandomNoise
};
const IMAGE_LOADERS = ["39", "40", "41", "42", "47", "57", "58", "59", "60", "61"]; // image1..image10
const IMAGE_SWITCHES = ["81", "82", "83", "84", "85", "86", "87", "88", "89", "90"]; // Use image1..10
export const MAX_REFERENCE_IMAGES = IMAGE_LOADERS.length;

export const ASPECTS: Record<string, string> = {
  "1:1": "1:1 (Square)",
  "2:3": "2:3 (Portrait Photo)",
  "3:2": "3:2 (Photo)",
  "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)",
  "9:16": "9:16 (Portrait Widescreen)",
  "16:9": "16:9 (Widescreen)",
  "21:9": "21:9 (Ultrawide)",
};

const RUN_TIMEOUT_MS = 15 * 60 * 1000;

export type ComfyRunOptions = {
  comfyUrl: string;
  workflowPath: string; // empty -> use the bundled default workflow
  prompt: string;
  references: string[]; // image file paths, in input-slot order
  aspectRatio: string; // key of ASPECTS
  megapixels: number;
  seed: number;
  signal: AbortSignal;
  status: (text: string) => void;
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Aborted"));
    });
  });
}

async function upload(comfyUrl: string, path: string, signal: AbortSignal): Promise<string> {
  const data = await readFile(path);
  const form = new FormData();
  form.append("image", new Blob([data]), `lmstudio_${Date.now()}_${basename(path)}`);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(`ComfyUI image upload failed (${res.status}): ${await res.text()}`);
  const info = (await res.json()) as { name: string; subfolder?: string };
  return info.subfolder ? `${info.subfolder}/${info.name}` : info.name;
}

/**
 * Cancel a prompt on ComfyUI: remove it from the queue if it is still waiting, and interrupt it if it
 * is the one currently running. Uses its own requests (not the aborted signal) so they still go out.
 */
export async function cancelPrompt(comfyUrl: string, promptId: string): Promise<void> {
  const post = (path: string, body: unknown) =>
    fetch(`${comfyUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    // Waiting in the queue -> delete it.
    await post("/queue", { delete: [promptId] });

    // Running now -> interrupt. Only interrupt if it is ours, so another job is not stopped by mistake.
    const res = await fetch(`${comfyUrl}/queue`);
    const queue = (await res.json()) as { queue_running?: any[][] };
    const running = (queue.queue_running ?? []).some(item => item?.[1] === promptId);
    if (running) await post("/interrupt", { prompt_id: promptId });
    console.info(`Cancelled ComfyUI prompt ${promptId} (was running: ${running}).`);
  } catch (e) {
    console.error(`Failed to cancel ComfyUI prompt ${promptId}:`, e);
  }
}

/** Run the workflow on ComfyUI and return the generated images as PNG buffers. */
export async function runComfy(o: ComfyRunOptions): Promise<Buffer[]> {
  const comfyUrl = o.comfyUrl.replace(/\/+$/, "");
  const wf: Record<string, any> = o.workflowPath.trim()
    ? JSON.parse(await readFile(o.workflowPath.trim(), "utf-8"))
    : structuredClone(defaultWorkflow);

  // Nodes that only talk to the ComfyUI frontend are not needed (and can misbehave) here.
  for (const [id, node] of Object.entries(wf)) {
    if (node?.class_type === "ImpactSetWidgetValue") delete wf[id];
  }

  wf[NODE.rawPrompt].inputs.value = o.prompt;
  wf[NODE.usePE].inputs.value = false;
  // Always generate a new image from the references (optional node; older workflows do not have it).
  if (wf[NODE.editImage1]) wf[NODE.editImage1].inputs.value = false;
  wf[NODE.resolution].inputs.aspect_ratio = ASPECTS[o.aspectRatio];
  wf[NODE.resolution].inputs.megapixels = o.megapixels;
  wf[NODE.batch].inputs.value = 1;
  wf[NODE.seed].inputs.noise_seed = o.seed;

  for (let i = 0; i < IMAGE_LOADERS.length; i++) {
    const loader = IMAGE_LOADERS[i];
    const sw = IMAGE_SWITCHES[i];
    if (i < o.references.length) {
      o.status(`Uploading reference image ${i + 1}/${o.references.length}...`);
      wf[loader].inputs.image = await upload(comfyUrl, o.references[i], o.signal);
      wf[sw].inputs.switch = true;
    } else {
      // Unused slot: cut the link so ComfyUI does not try to load a stale input file.
      wf[sw].inputs.switch = false;
      delete wf[sw].inputs.on_true;
      delete wf[loader];
    }
  }

  o.status("Queuing on ComfyUI...");
  const queued = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf, client_id: randomUUID() }),
    signal: o.signal,
  });
  if (!queued.ok) {
    throw new Error(`ComfyUI rejected the workflow (${queued.status}): ${(await queued.text()).slice(0, 1500)}`);
  }
  const { prompt_id: promptId } = (await queued.json()) as { prompt_id: string };

  // The user pressed Stop in LM Studio -> stop the job on ComfyUI too.
  const cancel: { done?: Promise<void> } = {};
  const onAbort = () => {
    console.info("Tool call aborted by user; cancelling the ComfyUI job.");
    cancel.done = cancelPrompt(comfyUrl, promptId);
  };
  if (o.signal.aborted) onAbort();
  else o.signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await waitForResult(comfyUrl, promptId, o);
  } finally {
    o.signal.removeEventListener("abort", onAbort);
    if (cancel.done) await cancel.done;
  }
}

async function waitForResult(comfyUrl: string, promptId: string, o: ComfyRunOptions): Promise<Buffer[]> {
  const started = Date.now();
  while (true) {
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error("ComfyUI did not finish within 15 minutes.");
    await sleep(1500, o.signal);
    o.status(`Generating on ComfyUI... ${Math.round((Date.now() - started) / 1000)}s`);
    const res = await fetch(`${comfyUrl}/history/${promptId}`, { signal: o.signal });
    if (!res.ok) continue;
    const rec = ((await res.json()) as Record<string, any>)[promptId];
    if (!rec) continue;

    const st = rec.status ?? {};
    if (st.status_str === "error") {
      const err = (st.messages ?? []).filter((m: any) => m?.[0] === "execution_error").pop();
      throw new Error(`ComfyUI error: ${JSON.stringify(err?.[1] ?? st).slice(0, 1500)}`);
    }
    if (!st.completed && !rec.outputs) continue;

    const buffers: Buffer[] = [];
    for (const out of Object.values<any>(rec.outputs ?? {})) {
      for (const img of out.images ?? []) {
        if (img.type !== "output") continue;
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: "output" });
        const r = await fetch(`${comfyUrl}/view?${q}`, { signal: o.signal });
        if (!r.ok) throw new Error(`Failed to download ${img.filename} from ComfyUI (${r.status}).`);
        buffers.push(Buffer.from(await r.arrayBuffer()));
      }
    }
    return buffers;
  }
}
