function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionsFromArgs(args) {
  if (isRecord(args?.options)) return args.options;
  return isRecord(args) ? args : {};
}

function filtersFrom(options) {
  if (!Array.isArray(options.filters)) return undefined;
  return options.filters
    .filter(
      (filter) =>
        isRecord(filter) &&
        typeof filter.name === "string" &&
        Array.isArray(filter.extensions),
    )
    .map((filter) => ({
      name: filter.name,
      extensions: filter.extensions.filter(
        (extension) => typeof extension === "string",
      ),
    }));
}

function electronOpenOptions(options) {
  const directory = options.directory === true;
  const properties = [directory ? "openDirectory" : "openFile"];
  if (options.multiple === true) properties.push("multiSelections");
  if (options.showHiddenFiles === true) properties.push("showHiddenFiles");
  if (options.createDirectory === true) properties.push("createDirectory");
  return {
    title: typeof options.title === "string" ? options.title : undefined,
    defaultPath:
      typeof options.defaultPath === "string" ? options.defaultPath : undefined,
    filters: filtersFrom(options),
    properties,
  };
}

function electronSaveOptions(options) {
  return {
    title: typeof options.title === "string" ? options.title : undefined,
    defaultPath:
      typeof options.defaultPath === "string" ? options.defaultPath : undefined,
    filters: filtersFrom(options),
    nameFieldLabel:
      typeof options.nameFieldLabel === "string"
        ? options.nameFieldLabel
        : undefined,
    showsTagField: options.showsTagField === true,
  };
}

export function createElectronDialogs({ dialog, getWindow }) {
  function parentWindow() {
    const window = getWindow();
    if (!window || window.isDestroyed?.()) {
      throw new Error("Electron window is unavailable");
    }
    return window;
  }

  return {
    handles(command) {
      return (
        command === "plugin:dialog|open" || command === "plugin:dialog|save"
      );
    },

    async invoke(command, args = {}) {
      const options = optionsFromArgs(args);
      if (command === "plugin:dialog|open") {
        const result = await dialog.showOpenDialog(
          parentWindow(),
          electronOpenOptions(options),
        );
        if (result.canceled || !Array.isArray(result.filePaths)) return null;
        if (options.multiple === true) return result.filePaths;
        return result.filePaths[0] ?? null;
      }
      if (command === "plugin:dialog|save") {
        const result = await dialog.showSaveDialog(
          parentWindow(),
          electronSaveOptions(options),
        );
        return result.canceled ? null : (result.filePath ?? null);
      }
      throw new Error(`Unsupported dialog command: ${command}`);
    },
  };
}
