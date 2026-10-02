// Match TypeScript: .ts before .tsx, then JS; platform suffixes within each extension.
// Runtime resolution deliberately excludes declaration-only .d.ts files.
export const godotExtensions = [
  '.godot.ts', '.native.ts', '.ts',
  '.godot.tsx', '.native.tsx', '.tsx',
  '.godot.js', '.native.js', '.js',
  '.godot.jsx', '.native.jsx', '.jsx', '.json',
];
