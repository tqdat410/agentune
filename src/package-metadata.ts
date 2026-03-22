import { readFileSync } from 'node:fs';

export interface PackageMetadata {
  description: string;
  version: string;
  engines?: {
    node?: string;
  };
}

export function readPackageMetadata(): PackageMetadata {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageMetadata;
}
