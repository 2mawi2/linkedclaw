import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/app/**/page.tsx", "src/app/**/route.ts", "src/app/**/layout.tsx", "src/lib/seed.ts"],
  project: ["src/**/*.{ts,tsx}"],
  ignore: ["src/__tests__/**"],
  ignoreDependencies: ["postcss", "tailwindcss"],
  ignoreExportsUsedInFile: true,
};

export default config;
