// typescript-eslint 8 no admite TypeScript 7 (ADR-0006).
// Sus paquetes usan la API de TypeScript 6 (@typescript/typescript6);
// `tsc` del proyecto sigue siendo TypeScript 7.
const TS6 = 'npm:@typescript/typescript6@6.0.2';

function readPackage(pkg) {
  const usesTs =
    pkg.name === 'typescript-eslint' ||
    pkg.name === 'ts-api-utils' ||
    pkg.name.startsWith('@typescript-eslint/');
  if (usesTs && pkg.peerDependencies && pkg.peerDependencies.typescript) {
    delete pkg.peerDependencies.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: TS6 };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
