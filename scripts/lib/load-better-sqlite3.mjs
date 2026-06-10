import { createRequire } from 'node:module';
import path from 'node:path';

export async function loadBetterSqlite3(rootDir = process.cwd()) {
  try {
    const rootRequire = createRequire(path.join(rootDir, 'package.json'));
    return rootRequire('better-sqlite3');
  } catch {
    const nativeRequire = createRequire(path.join(rootDir, 'app', 'native-server', 'package.json'));
    return nativeRequire('better-sqlite3');
  }
}
