import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appRoot = path.join(root, 'packages/app-tauri');
const targets = {
  'windows-x64': 'x86_64-pc-windows-msvc',
  'macos-arm64': 'aarch64-apple-darwin',
};

export function validateInputs(commit, tag) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('A full lowercase source commit SHA is required');
  const match = /^v(\d+\.\d+\.\d+)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.exec(tag ?? '');
  if (!match) throw new Error('Invalid release tag');
  return match[1];
}

export async function validateRelease(commit, tag) {
  const version = validateInputs(commit, tag);
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (actual !== commit) throw new Error('The checkout does not match the requested source commit');
  const config = JSON.parse(await readFile(path.join(appRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const cargo = await readFile(path.join(appRoot, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/.exec(cargo)?.[1];
  const lock = await readFile(path.join(appRoot, 'src-tauri/Cargo.lock'), 'utf8');
  const lockVersion = /\[\[package\]\]\nname = "opendicomviewer-desktop"\nversion = "([^"]+)"/.exec(lock)?.[1];
  if ([config.version, pkg.version, cargoVersion, lockVersion].some(value => value !== version)) {
    throw new Error('Release tag base version must match package.json, Tauri, Cargo.toml, and Cargo.lock');
  }
  return { version, productName: config.productName };
}

export async function singleArtifact(folder, suffix) {
  const files = (await readdir(folder)).filter(name => name.endsWith(suffix));
  if (files.length !== 1) throw new Error(`Expected one ${suffix} artifact in ${folder}, found ${files.length}`);
  const file = path.join(folder, files[0]);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size === 0) throw new Error('Package is empty or is not a regular file');
  return file;
}

export async function checksumFile(file) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function collectPackages(bundle, output, tag, platform, productName) {
  const prefix = `OpenDicomViewer-${tag}-${platform}`;
  const files = [];
  const copy = async (source, name) => {
    await copyFile(source, path.join(output, name), constants.COPYFILE_EXCL);
    files.push(name);
  };
  if (platform === 'windows-x64') {
    await copy(await singleArtifact(path.join(bundle, 'nsis'), '-setup.exe'), `${prefix}-setup.exe`);
  } else {
    await copy(await singleArtifact(path.join(bundle, 'dmg'), '.dmg'), `${prefix}.dmg`);
    const app = path.join(bundle, 'macos', `${productName}.app`);
    if (!(await stat(app)).isDirectory()) throw new Error('macOS application bundle is missing');
    const name = `${prefix}.app.zip`;
    execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(output, name)]);
    files.push(name);
  }
  return Promise.all(files.map(async name => ({
    name, sha256: await checksumFile(path.join(output, name)), size: (await stat(path.join(output, name))).size,
  })));
}

async function writeManifest(output, tag, version, commit, platform, target, artifacts) {
  const manifestName = `build-${platform}.json`;
  await writeFile(path.join(output, manifestName), JSON.stringify({
    tag, applicationVersion: version, sourceCommit: commit, platform, target,
    buildHost: { os: process.platform, architecture: process.arch },
    signing: 'No Developer ID/notarization or Windows publisher certificate is configured.',
    runtimeAcceptance: 'Build and tests only; platform GUI acceptance is recorded separately.', artifacts,
  }, null, 2) + '\n', { flag: 'wx' });
  const sums = [...artifacts.map(file => `${file.sha256}  ${file.name}`), `${await checksumFile(path.join(output, manifestName))}  ${manifestName}`];
  await writeFile(path.join(output, `SHA256SUMS-${platform}.txt`), sums.join('\n') + '\n', { flag: 'wx' });
  console.log(`Collected ${artifacts.length} ${platform} packages from ${commit}`);
}

async function collect(commit, tag, platform) {
  const { version, productName } = await validateRelease(commit, tag);
  const target = targets[platform];
  if (!target) throw new Error('Unsupported release platform');
  const expectedHost = platform === 'windows-x64' ? ['win32', 'x64'] : ['darwin', 'arm64'];
  if (process.platform !== expectedHost[0] || process.arch !== expectedHost[1]) throw new Error('Release must be collected on its native build host');
  const bundle = path.join(appRoot, 'src-tauri/target', target, 'release/bundle');
  const output = path.join(root, 'release-artifacts', platform);
  await mkdir(path.dirname(output), { recursive: true });
  // An existing collection is not overwritten, so stale packages cannot silently enter a release.
  await mkdir(output);
  const artifacts = await collectPackages(bundle, output, tag, platform, productName);
  await writeManifest(output, tag, version, commit, platform, target, artifacts);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === 'validate') await validateRelease(process.env.SOURCE_COMMIT, process.env.RELEASE_TAG);
    else if (process.argv[2] === 'collect') await collect(process.env.SOURCE_COMMIT, process.env.RELEASE_TAG, process.env.RELEASE_PLATFORM);
    else throw new Error('Expected validate or collect command');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  }
}
