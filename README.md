# comfyui-image-gen

[日本語](README.ja.md)

An LM Studio plugin that lets a local vision-language model generate and edit images with **Qwen Image 2.1 on your local ComfyUI** — straight from the chat.

- Chat with a local VL model (e.g. Qwen3-VL) as usual. When you ask for an image, the model calls the `generate_image` tool and ComfyUI renders it.
- Attached images and generated images get short labels — `[a1]`, `[a2]`, … for attachments and `[v1]`, `[v2]`, … for generated images — and the model **actually sees** all of them. Say "put the apple from this picture on a plate" and the right image is passed to ComfyUI as a reference.
- Generated images are shown in the chat by the plugin itself (no 1 MB tool-result limit, full resolution).
- Stopping the generation in LM Studio also cancels the job on ComfyUI.

```
You:    [attach apple.jpg, banana.png] Put these on one plate
Chat:   [a1][a2]として画像をアップロードしました。[a1][a2]を入力して、画像の生成を開始します。
        (image)
        [a1][a2]を入力して[v1] (りんごとバナナのお皿)を生成しました。
You:    Make the plate in this image blue
Chat:   [v1]を入力して、画像の生成を開始します。
```

(The plugin's status messages are in Japanese for now: "uploaded [a1][a2] … generating with [a1][a2]" / "generated [v1] (title) from [a1][a2]".)

## Requirements

- **LM Studio** with plugin support and the `lms` CLI
- **Node.js** (for `lms dev`)
- A **vision-language model** loaded in LM Studio (tested with Qwen3-VL 8B) and LM Studio's **local server running** (default `http://127.0.0.1:1234`)
- **ComfyUI** running locally (default `http://127.0.0.1:8188`) with Qwen Image 2.1 set up

### ComfyUI side

The plugin comes with a Qwen Image 2.1 reference-to-image workflow in `workflows/`:

| File | Format | Use |
|---|---|---|
| `workflows/QI21_Ref2I.json` | UI | Open in ComfyUI to check, run or edit the workflow by hand |
| `workflows/QI21_Ref2I_api.json` | API (*Export (API)*) | Bundled into the plugin and used when **Workflow (API format)** is empty |

The image inputs in both files point to ComfyUI's sample `example.png`; the plugin replaces them with your images.

The workflow uses these model files:

| Type | File |
|---|---|
| diffusion model (`models/diffusion_models`) | `qwen_image_2.1_int8_convrot.safetensors` |
| text encoder (`models/text_encoders`) | `qwen3vl_8b_int8_convrot.safetensors` |
| text encoder for prompt rewriting (`models/text_encoders`) | `qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors` |
| VAE (`models/vae`) | `texture_fix_vae_for_qwen_image_2.1_bf16.safetensors` ([madebyollin/texture-fix-vae-for-qwen-image-2.1](https://huggingface.co/madebyollin/texture-fix-vae-for-qwen-image-2.1)) |

It also uses the `res_2s` sampler from [RES4LYF](https://github.com/ClownsharkBatwing/RES4LYF) and a few nodes that may come from custom node packs. The easiest way to check: drag `workflows/QI21_Ref2I.json` into ComfyUI and use **ComfyUI Manager → Install Missing Custom Nodes**. If your setup is different, use your own workflow (see [Using your own workflow](#using-your-own-workflow)).

## Installation

```bash
git clone https://github.com/ai-douga-lab/comfyui-image-gen.git
cd comfyui-image-gen
npm install
lms dev
```

`lms dev` builds the plugin and registers it in LM Studio while it is running.

## Setup in LM Studio

1. Load your VL model and start the local server (Developer tab).
2. In a chat, pick **comfyui-image-gen** in the model selector.
3. In the plugin's settings, set **Model** to the ID of the loaded VL model (check with `lms ps`, e.g. `qwen/qwen3-vl-8b`).
   **This is required for image attachments:** LM Studio decides whether you can drop images into the chat from this model. If it is empty (or a text-only model), dropping an image fails with *"Model does not support image input"*.
4. Check the global settings below (ComfyUI URL, etc.).
5. If you also have other image MCP servers (e.g. a ComfyUI MCP or a filesystem MCP) enabled, turn them off for this chat — the model may otherwise try to "open" images with them instead of looking at them.

## Usage

- **Generate:** "Draw a red apple on a wooden table."
- **Use an attachment as reference:** attach an image and say "Make this cat wear a hat." Images attached to your message are used as references automatically (can be turned off).
- **Edit a generated image:** "Make the background of this image blue." "This image" means the most recent one; you can also name labels explicitly: "Put the cat from [a1] on the sofa from [v2]."
- **Several references:** up to 10 images per generation (the workflow has 10 image slots).
- **Cancel:** press stop in LM Studio. The ComfyUI job is removed from the queue or interrupted.

Generated images are saved in the chat's working directory with an English file name chosen by the model (e.g. `apple_on_plate.png`). With **Also save images to this folder** you get an extra copy named with the title in your language.

## Settings

Per-chat (plugin config):

| Setting | Default | Description |
|---|---|---|
| Model | (empty) | Model ID of the VL model on the endpoint |

Global:

| Setting | Default | Description |
|---|---|---|
| Base URL | `http://127.0.0.1:1234/v1` | OpenAI-compatible endpoint of the chat model |
| ComfyUI URL | `http://127.0.0.1:8188` | Local ComfyUI server |
| Workflow (API format) | (empty = bundled) | Path to a workflow exported with *Export (API)* |
| Reference image format in prompt | `<image{n}>` | How `[a1]`/`[v1]` are rewritten; `{n}` is the slot number |
| Always use attached images as references | on | Add the images attached to your message even if the model forgot to mention them |
| Let the model comment on generated images | off | On: the model looks at the result and comments (slower). Off: the turn ends right after the image is shown. The model can see `[v1]`… later either way. |
| Generated image size (megapixels) | `0.5` | Size of the images generated on ComfyUI (0.5 ≈ 720×720, 1.0 ≈ 1024×1024, 4.0 ≈ 2K). The model overrides it only when you ask for a bigger or smaller image |
| Image size sent to the model (megapixels) | `0.5` | Images shown to the chat model are shrunk to this size (cached in the chat folder). Big images make replies very slow, because every image is sent again on every turn. ComfyUI always gets the originals. `0` = unchanged |
| Also save images to this folder | (empty) | Extra copy of every image, named with its title |

## Using your own workflow

Export your workflow from ComfyUI with **Export (API)** and set its path in **Workflow (API format)**. The easiest start is to open `workflows/QI21_Ref2I.json`, change it, and export it. The plugin finds nodes by ID, so your workflow needs the same structure as the bundled one, or you need to update the IDs at the top of `src/comfy.ts`:

| Purpose | Node ID | Node |
|---|---|---|
| prompt | `74` | `PrimitiveStringMultiline` (`value`) |
| prompt enhancer on/off | `76` | `PrimitiveBoolean` (set to `false`) |
| "Edit image1": start from image1 instead of an empty latent | `95` | `PrimitiveBoolean` (always `false` for now, see [TODO](#todo); optional) |
| size | `29` | `ResolutionSelector` (`aspect_ratio`, `megapixels`) |
| batch size | `56` | int (`value`, set to 1) |
| seed | `7` | `RandomNoise` (`noise_seed`) |
| reference images 1–10 | `39 40 41 42 47 57 58 59 60 61` | `LoadImage` |
| reference on/off 1–10 | `81`–`90` | `ComfySwitchNode` (`switch`, `on_true`) |

Unused image slots are switched off and their `LoadImage` nodes are removed before the workflow is queued.

## How it works

### Overview

```
                       ┌──────────────────────── plugin ────────────────────────┐
LM Studio chat ──────► │ generator (src/generator.ts)                          │ ──► VL model on LM Studio's
 (history, attached    │  · builds the request: text + labeled images          │     local server (OpenAI API)
  files)               │  · shows images and status messages in the chat       │ ◄── text / tool call
                       │                    │ comfy_media.json (per chat)      │
                       │                    ▼                                  │
                       │ tool generate_image (src/toolsProvider.ts, comfy.ts)  │ ──► ComfyUI
                       │  · labels → files → <image1>…, uploads, runs workflow │ ◄── generated PNG
                       └────────────────────────────────────────────────────────┘
```

One chat turn with a generation looks like this:

1. You send a message (maybe with images). LM Studio calls the plugin's **generator** with the whole chat history.
2. The generator labels every image, builds an OpenAI-style request with the text and the images, and streams it to the VL model on LM Studio's local server.
3. The model answers with a `generate_image` tool call whose prompt contains labels such as `[a1]`.
4. Before handing the tool call to LM Studio, the generator prints "[a1]を入力して、画像の生成を開始します。" in the chat.
5. LM Studio runs the **tool**. It resolves the labels to files, uploads them to ComfyUI, runs the workflow, saves the result as `[v1]` and returns a short text result.
6. LM Studio calls the generator again (the history now ends with the tool result). The generator shows the new image in the chat and either ends the turn (default) or sends the image to the model so it can comment on it.

### Why a generator and not just a tool (MCP)

The first version was an MCP server (and a plain tool plugin works the same way). It could generate images, but in practice it broke down in several places:

- **The model never saw its own result.** LM Studio does not pass images returned by a tool to the model, so the model could not check or describe what it had just generated, and "make this image bluer" had nothing to refer to.
- **A tool cannot see the chat.** A tool only receives the arguments the model writes. To use an attached image, the model had to put its file path into the arguments — but the model does not know where LM Studio stores attachments, so it invented paths.
- **Showing images was awkward.** Returning the image from the tool hit LM Studio's 1 MB limit for tool results, so only small previews could be shown.
- Long generations ran into the MCP request timeout (60 s by default).

A **generator** replaces the model in the chat: LM Studio gives it the full history (including attached files) and the generator decides what to send to the actual model and what to write into the chat. That solves all of the above:

- it can attach every image — attachments and generated ones — to the request itself, with labels;
- it can write the shared label table that the tool needs to resolve `[a1]` to a file;
- it can put the generated image directly into the chat at full size (as a Markdown image pointing to the file), with no tool-result limit.

The price is that the generator has to call the model itself. That is why the plugin needs **Base URL** (LM Studio's local server) and **Model**, and why the local server must be running.

### How images are passed to the model

LM Studio stores attached files itself. For each user message the generator asks LM Studio for its files (`ChatMessage.getFiles()`), keeps the images, gets their local paths (`FileHandle.getFilePath()`), shrinks them to **Image size sent to the model** (0.5 MP by default, JPEG) and sends them as base64 `image_url` parts in the OpenAI chat format. Each image is preceded by a text part with its label:

```jsonc
{ "role": "user", "content": [
  { "type": "text", "text": "[a1]" },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } },
  { "type": "text", "text": "[a2]" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } },
  { "type": "text", "text": "Put these on one plate" }
]}
```

Generated images cannot go into the tool message (the OpenAI format and most local chat templates only allow text there). So right after each tool result the generator inserts an extra user message containing `[v1] (generated image)`, the image itself, and "These are the images you just generated."

The whole history is rebuilt like this on every turn, so the model sees every image of the conversation every time. That is what makes "the cat from the first picture" work many turns later. It also means long conversations with many images use a lot of context.

### How the model knows which image is meant

- **Labels next to the images.** The model sees `[a1]` immediately before the picture, so it can connect the name with what it sees.
- **A note in the system prompt.** It explains the label scheme, tells the model to write labels into the `generate_image` prompt, and forbids opening images with tools or guessing file paths. It also names the most recent image(s) ("The most recent image in this conversation is [v2]"), so "this image" resolves to the latest one. The note is merged into the existing system prompt, because some chat templates (such as Qwen's) accept only one system message at the very beginning.
- **Automatic references.** Small models often forget to write `[a1]` for an image you just attached. Images attached to the current message that are missing from the prompt are added automatically (`Using [a1] and [a2] as reference images: …`). This can be turned off.
- **Validation.** If the prompt contains a label that does not exist, the tool returns an error that lists the available labels, and the model can try again.

### How labels are tied to files

The generator and the tool run separately, and the tool only gets the arguments written by the model. They share a small table, `comfy_media.json`, stored in the chat's working directory (`getWorkingDirectory()`, one folder per chat, so images of different chats never mix):

```jsonc
{
  "attachments":     { "a1": "C:\\…\\apple.jpg", "a2": "C:\\…\\banana.png" },
  "turnAttachments": ["a1", "a2"],
  "variants":        { "v1": "C:\\…\\<chat folder>\\apple_banana_plate.png" },
  "info":            { "v1": { "refs": ["a1", "a2"], "title": "りんごとバナナのお皿" } }
}
```

- **`a` labels** are numbered by order of appearance: the first attached image in the chat is `[a1]`, and so on. The generator recomputes them from the history on every turn and writes them to the table before calling the model. `turnAttachments` lists the images of the latest message, for the automatic references.
- **`v` labels** are given by the tool when it saves a result: the next free number, never renumbered. The file goes into the chat's working directory with an ASCII name chosen by the model. `info` records the references and title for the status message.
- The tool result ends with a marker such as `(comfy-gen: v1)`. That is how the generator, which only sees the history, knows which images a tool call produced, so it can show them in the chat and to the model.

When the tool runs, it collects the labels in the prompt in order of first appearance and gives them input slots 1, 2, 3… It rewrites each label in the prompt with **Reference image format in prompt** (`[a1]` → `<image1>`), uploads each file to ComfyUI (`/upload/image`) and puts it into the `LoadImage` node of that slot. Unused slots are switched off, and their `LoadImage` nodes are removed. Then it queues the workflow (`/prompt`), polls `/history` until it finishes, and downloads the result (`/view`).

### Cancelling

The tool watches LM Studio's abort signal. When you press stop, it removes the job from the ComfyUI queue (`POST /queue {delete}`) and, if the job is already running, interrupts it (`POST /interrupt`).

## Known limitations

- LM Studio does not pass images returned by tools to the model, so the plugin re-injects generated images itself. This only works because the plugin is the generator.
- LM Studio shows local images with non-ASCII file names as "External Image", so file names in the chat are kept ASCII. Use the export folder for names in your language.
- `a` labels are counted from the chat history, so editing or deleting an earlier message with images can shift the numbers of later attachments.
- The plugin's own messages ("Generating with [a1]…") are currently in Japanese.

## TODO

- **Edit mode (rewrite the first reference image instead of generating from scratch).** The bundled workflow already has an **Edit image1** switch (node `95`): when on, sampling starts from reference image 1 (VAE-encoded, node `93` → `94`) instead of an empty latent, so the result keeps that image's composition and size. The plugin currently always turns it off. To use it:
  - add a parameter to `generate_image` (e.g. `edit_base: "[v1]"` or `mode: "edit"`), put that image in slot 1 and set node `95` to `true`;
  - tell the model in the system prompt / tool description when to use it (small changes to an existing image: "make the plate blue", "remove the cup") and when not to (new scenes, combining several images);
  - decide how size/aspect ratio work in this mode (the output follows image1, so `aspect_ratio`/`megapixels` should probably be ignored).
- English versions of the plugin's status messages (currently Japanese only).

## Credits

Based on LM Studio's `openai-compat-endpoint` plugin template. Uses [@lmstudio/sdk](https://www.npmjs.com/package/@lmstudio/sdk), [openai](https://www.npmjs.com/package/openai) and [zod](https://www.npmjs.com/package/zod).

## License

[MIT](LICENSE)
