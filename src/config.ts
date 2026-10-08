import { createConfigSchematics } from "@lmstudio/sdk";

// This file contains the definition of configuration schematics for your plugin.

export const configSchematics = createConfigSchematics()
  .field(
    "model",
    "string",
    {
      displayName: "Model",
      subtitle: "Model ID on the endpoint (check with `lms ps`).",
      placeholder: "qwen/qwen3-vl-8b",
    },
    "",
  )
  .build();

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "baseUrl",
    "string",
    {
      displayName: "Base URL",
      subtitle: "OpenAI-compatible endpoint of the chat model (LM Studio's local server by default).",
      placeholder: "http://127.0.0.1:1234/v1",
    },
    "http://127.0.0.1:1234/v1",
  )
  .field(
    "comfyUrl",
    "string",
    {
      displayName: "ComfyUI URL",
      subtitle: "URL of the local ComfyUI server.",
      placeholder: "http://127.0.0.1:8188",
    },
    "http://127.0.0.1:8188",
  )
  .field(
    "workflowPath",
    "string",
    {
      displayName: "Workflow (API format)",
      subtitle:
        "Full path of a ComfyUI workflow exported with 'Export (API)'. Leave empty to use the workflow bundled with the plugin.",
      placeholder: "(bundled workflows/QI21_Ref2I_api.json)",
    },
    "",
  )
  .field(
    "refFormat",
    "string",
    {
      displayName: "Reference image format in prompt",
      subtitle: "How [a1]/[v1] labels are rewritten for the image model. {n} is the input slot number (1, 2, ...).",
      placeholder: "<image{n}>",
    },
    "<image{n}>",
  )
  .field(
    "autoAttachRefs",
    "boolean",
    {
      displayName: "Always use attached images as references",
      subtitle:
        "If the user's message has image attachments that the model did not mention in the prompt, add them as reference images automatically.",
    },
    true,
  )
  .field(
    "reviewGenerated",
    "boolean",
    {
      displayName: "Let the model comment on generated images",
      subtitle:
        "On: after generating, the model looks at the image and comments on it (slower). " +
        "Off: the image is shown and the turn ends right away. Either way, the model can see and refer to [v1], [v2], ... later.",
    },
    false,
  )
  .field(
    "outputMegapixels",
    "numeric",
    {
      displayName: "Generated image size (megapixels)",
      subtitle:
        "Size of the images generated on ComfyUI (0.5 ≈ 720×720, 1.0 ≈ 1024×1024, 4.0 ≈ 2K). " +
        "The model only changes it when you ask for a bigger or smaller image.",
      min: 0.2,
      max: 4,
      step: 0.1,
      slider: { min: 0.2, max: 4, step: 0.1 },
    },
    0.5,
  )
  .field(
    "visionMegapixels",
    "numeric",
    {
      displayName: "Image size sent to the model (megapixels)",
      subtitle:
        "Images shown to the chat model are shrunk to this size, which makes replies much faster when the chat " +
        "has many images. ComfyUI always gets the original images. 0 = send images unchanged.",
      min: 0,
      max: 16,
      step: 0.1,
      slider: { min: 0, max: 4, step: 0.1 },
    },
    0.5,
  )
  .field(
    "exportDir",
    "string",
    {
      displayName: "Also save images to this folder",
      subtitle:
        "Optional. Every generated image is also copied here, named with its title in your language " +
        "(e.g. りんごとバナナの画像.png). Leave empty to disable.",
      placeholder: "S:\\ComfyUI-mcp\\outputs",
    },
    "",
  )
  .build();
