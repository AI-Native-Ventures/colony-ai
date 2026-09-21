export function hasRequiredLinuxSandboxIsolation(
  namespaceDifferences,
  rootDiffers,
) {
  return (
    namespaceDifferences.includes("pid") &&
    namespaceDifferences.includes("net") &&
    namespaceDifferences.includes("user") &&
    rootDiffers === true
  );
}
