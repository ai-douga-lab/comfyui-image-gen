import { type PluginContext } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { generate } from "./generator";
import { toolsProvider } from "./toolsProvider";

export async function main(context: PluginContext) {
  context.withConfigSchematics(configSchematics);
  context.withGlobalConfigSchematics(globalConfigSchematics);
  context.withGenerator(generate);
  context.withToolsProvider(toolsProvider);
}
