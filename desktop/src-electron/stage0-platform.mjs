const TARGETS = Object.freeze({
  "darwin:arm64": Object.freeze({
    platform: "darwin",
    arch: "arm64",
    targetTriple: "aarch64-apple-darwin",
    helperName: "colony-native-host",
    packageSuffix: "darwin-arm64",
    bundleKind: "app",
  }),
  "win32:x64": Object.freeze({
    platform: "win32",
    arch: "x64",
    targetTriple: "x86_64-pc-windows-msvc",
    helperName: "colony-native-host.exe",
    packageSuffix: "win32-x64",
    bundleKind: "directory",
  }),
});

function targetKey(platform, arch) {
  return `${platform}:${arch}`;
}

export function getStage0Target({
  platform = process.platform,
  arch = process.arch,
  targetTriple = null,
} = {}) {
  const target = TARGETS[targetKey(platform, arch)];
  if (!target) {
    throw new Error(`unsupported Stage 0 target: ${platform}/${arch}`);
  }
  if (targetTriple !== null && targetTriple !== target.targetTriple) {
    throw new Error(
      `target triple ${targetTriple} does not match ${target.targetTriple}`,
    );
  }
  return target;
}

export function getStage0TargetFromArguments(argumentsList = process.argv) {
  const valueFor = (name) => {
    const argument = argumentsList.find((value) =>
      value.startsWith(`--${name}=`),
    );
    return argument?.slice(name.length + 3) ?? null;
  };
  return getStage0Target({
    platform: valueFor("platform") ?? process.platform,
    arch: valueFor("arch") ?? process.arch,
    targetTriple: valueFor("target"),
  });
}
