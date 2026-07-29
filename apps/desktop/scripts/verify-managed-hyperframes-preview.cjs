const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

function fail(message) {
  throw new Error(message);
}

async function fileEvidence(candidate) {
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail('Packaged smoke input is not a regular file.');
  }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(candidate)) digest.update(chunk);
  return {
    sha256: digest.digest('hex'),
    sizeBytes: stat.size,
  };
}

async function physicalFileEvidence(candidate) {
  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    return await fileEvidence(candidate);
  } finally {
    process.noAsar = previousNoAsar;
  }
}

async function inventory(root) {
  const files = [];
  const visit = async (current) => {
    const entries = (await fs.readdir(current, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) fail('Packaged smoke output contains a symbolic link.');
      if (stat.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!stat.isFile()) fail('Packaged smoke output contains an unsupported file type.');
      const data = await fs.readFile(candidate);
      files.push({
        name: path.relative(root, candidate).replace(/\\/g, '/'),
        bytes: data.byteLength,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
  };
  await visit(root);
  return files;
}

async function packagedHyperframesDiagnostics(appRoot) {
  const packagePath = path.join(appRoot, 'node_modules', 'hyperframes', 'package.json');
  const cliPath = path.join(appRoot, 'node_modules', 'hyperframes', 'dist', 'cli.js');
  try {
    const packageBytes = await fs.readFile(packagePath);
    const cliBytes = await fs.readFile(cliPath);
    const manifest = JSON.parse(packageBytes.toString('utf8'));
    return {
      packageSha256: createHash('sha256').update(packageBytes).digest('hex'),
      cliSha256: createHash('sha256').update(cliBytes).digest('hex'),
      packageName: manifest.name,
      packageVersion: manifest.version,
      packageBin: manifest.bin && manifest.bin.hyperframes,
      packageLicense: manifest.license,
      packageNodeEngine: manifest.engines && manifest.engines.node,
      packageKeys: Object.keys(manifest).sort(),
      packageRealpath: await fs.realpath(packagePath),
      cliRealpath: await fs.realpath(cliPath),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to inspect packaged HyperFrames.',
    };
  }
}

async function assertInteriorSnapshotTimes(projectRoot, frameFiles) {
  const workflow = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'video-workflow.json'), 'utf8'),
  );
  const scenes = Array.isArray(workflow.scenes) ? workflow.scenes : [];
  const durations = scenes.map((scene) => Number(
    scene && (scene.minimum_duration_s ?? scene.duration_s),
  ));
  if (
    scenes.length < 3
    || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)
  ) {
    return;
  }

  const ranges = [];
  let cursor = 0;
  for (const duration of durations) {
    ranges.push({ start: cursor, end: cursor + duration });
    cursor += duration;
  }
  for (const file of frameFiles) {
    const match = /-at-(\d+(?:\.\d+)?)s\.png$/i.exec(file.name);
    if (!match) fail('Packaged snapshot filename does not contain an attested timestamp.');
    const timestamp = Number(match[1]);
    if (!ranges.some((range) => timestamp > range.start && timestamp < range.end)) {
      fail('Packaged snapshot was captured on a timeline or scene boundary.');
    }
  }
}

async function main() {
  const [appRootInput, projectRootInput, runtimeRootInput, browserPathInput] = process.argv.slice(2);
  if (!appRootInput || !projectRootInput || !runtimeRootInput || !browserPathInput) {
    fail('Usage: verify-managed-hyperframes-preview.cjs <app.asar> <project> <runtime-root> <browser>');
  }
  if (!process.versions.electron) fail('The smoke harness must run through packaged Electron.');

  const appRoot = path.resolve(appRootInput);
  const projectRoot = path.resolve(projectRootInput);
  const runtimeRoot = path.resolve(runtimeRootInput);
  const browserPath = path.resolve(browserPathInput);
  const appManifest = JSON.parse(
    await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );
  const appVersion = typeof appManifest.version === 'string' ? appManifest.version : '';
  if (!appVersion) fail('Packaged app version is unavailable.');
  const inputArtifacts = {
    executable: await fileEvidence(process.execPath),
    appRoot: await physicalFileEvidence(appRoot),
    harness: await fileEvidence(__filename),
    browser: await fileEvidence(browserPath),
  };
  const runtimeParent = path.dirname(runtimeRoot);
  await fs.mkdir(runtimeParent, { recursive: true });
  try {
    await fs.mkdir(runtimeRoot);
  } catch (error) {
    if (error && error.code === 'EEXIST') fail('Runtime proof root must be new and empty.');
    throw error;
  }

  const serviceModule = path.join(
    appRoot,
    'dist',
    'main',
    'customer-marketing',
    'customer-video-studio-service.js',
  );
  const { CustomerVideoStudioService } = require(serviceModule);
  delete process.env.STARIZZI_HYPERFRAMES_NODE;
  process.env.STARIZZI_HYPERFRAMES_BROWSER = browserPath;
  const workspaceId = 'customer-' + createHash('sha256')
    .update(projectRoot)
    .digest('hex')
    .slice(0, 12);
  const service = new CustomerVideoStudioService({
    rootPath: runtimeRoot,
    appRoot,
    managedBrowserPath: browserPath,
  });
  const toolchain = await service.getToolchain();
  if (!toolchain.previewAvailable) {
    const diagnostics = await packagedHyperframesDiagnostics(appRoot);
    fail('Packaged managed HyperFrames preview is unavailable: ' + JSON.stringify({
      toolchain,
      diagnostics,
    }));
  }
  if (toolchain.commercialRenderAvailable) fail('Managed Electron must not enable commercial render.');

  const imported = await service.importProject(workspaceId, projectRoot);
  const preview = await service.runPreview(
    workspaceId,
    imported.runtimeProjectId,
    imported.evidenceDigest,
  );
  service.killAll();
  if (!preview.receipt.passed) {
    fail('Packaged preview quality gate did not pass: ' + JSON.stringify(preview.receipt));
  }
  if (preview.receipt.snapshotCount < 1) {
    fail('Packaged preview did not produce a verified PNG snapshot.');
  }

  const files = await inventory(runtimeRoot);
  const previewPrefix = [
    workspaceId,
    'preview-runs',
    imported.runtimeProjectId,
  ].join('/') + '/';
  const projectPrefix = [
    workspaceId,
    'projects',
    imported.runtimeProjectId,
  ].join('/') + '/';
  const frameFiles = files.filter((file) => (
    file.name.startsWith(previewPrefix)
    && file.name.toLowerCase().endsWith('.png')
  ));
  if (frameFiles.length !== preview.receipt.snapshotCount) {
    fail('Packaged preview receipt does not match the verified PNG inventory.');
  }
  if (!files.some((file) => (
    file.name.startsWith(previewPrefix)
    && file.name.endsWith('contact-sheet.jpg')
  ))) {
    fail('Packaged preview did not produce a contact sheet under preview-runs.');
  }
  if (files.some((file) => (
    file.name.startsWith(projectPrefix)
    && (file.name.includes('/snapshots/') || file.name.includes('/receipts/'))
  ))) {
    fail('Packaged preview wrote generated output into the imported project.');
  }
  await assertInteriorSnapshotTimes(projectRoot, frameFiles);

  process.stdout.write(JSON.stringify({
    status: 'pass',
    customerProof: 'local_packaged_windows_x64',
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion,
    hyperframesVersion: toolchain.hyperframes.version,
    inputArtifacts,
    runtimeSource: 'managed_electron',
    workspaceId,
    runtimeProjectId: imported.runtimeProjectId,
    evidenceDigest: imported.evidenceDigest,
    receipt: preview.receipt,
    artifacts: preview.artifacts,
    outputFiles: files,
    snapshotFrames: frameFiles,
    hostPathEntries: (process.env.PATH || '').split(path.delimiter).filter(Boolean).length,
    commercialRenderAvailable: toolchain.commercialRenderAvailable,
    externalActionsPerformed: false,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    status: 'fail',
    error: error instanceof Error ? error.message : 'Unknown packaged smoke failure.',
    externalActionsPerformed: false,
  }, null, 2));
  process.exitCode = 1;
});
