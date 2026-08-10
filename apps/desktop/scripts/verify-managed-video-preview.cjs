const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let smokeDiagnostic = null;

function fail(message) {
  throw new Error(message);
}

async function fileEvidence(candidate) {
  const stat = await fs.lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('Smoke input is not a regular file.');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(candidate)) digest.update(chunk);
  return { sha256: digest.digest('hex'), sizeBytes: stat.size };
}

async function runtimeScratchDirectories(parent) {
  return (await fs.readdir(parent, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('izzi-ai-hf-'))
    .map((entry) => entry.name)
    .sort();
}

async function copyVerifiedVoiceArtifacts(sourceRoot, destinationRoot) {
  const entries = (await fs.readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^voice-\d{2}\.wav$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length < 1 || entries.length > 24) {
    fail('Voice input must contain between 1 and 24 numbered WAV files.');
  }
  entries.forEach((entry, index) => {
    const expected = `voice-${String(index + 1).padStart(2, '0')}.wav`;
    if (entry.name !== expected) fail('Voice input names must be contiguous and ordered.');
  });
  await fs.mkdir(destinationRoot, { recursive: true });
  const artifacts = [];
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry.name);
    const sourceStat = await fs.lstat(source);
    if (sourceStat.isSymbolicLink()) fail('Voice input cannot be a symbolic link.');
    const destination = path.join(destinationRoot, entry.name);
    await fs.copyFile(source, destination);
    const evidence = await fileEvidence(destination);
    artifacts.push({
      name: 'voice-preview/' + entry.name,
      sha256: evidence.sha256,
      sizeBytes: evidence.sizeBytes,
    });
  }
  return artifacts;
}

async function main() {
  const [
    appRootInput,
    projectRootInput,
    voiceRootInput,
    runtimeRootInput,
    browserPathInput,
    ffmpegPathInput,
    ffprobePathInput,
    nodePathInput,
  ] = process.argv.slice(2);
  if (
    !appRootInput
    || !projectRootInput
    || !voiceRootInput
    || !runtimeRootInput
    || !browserPathInput
    || !ffmpegPathInput
    || !ffprobePathInput
    || !nodePathInput
  ) {
    fail(
      'Usage: verify-managed-video-preview.cjs '
      + '<app-root> <project> <voice-root> <runtime-root> <browser> <ffmpeg> <ffprobe> <node>',
    );
  }
  if (!process.versions.electron) fail('The smoke harness must run through packaged Electron.');

  const appRoot = path.resolve(appRootInput);
  const projectRoot = path.resolve(projectRootInput);
  const voiceRoot = path.resolve(voiceRootInput);
  const runtimeRoot = path.resolve(runtimeRootInput);
  const browserPath = path.resolve(browserPathInput);
  const ffmpegPath = path.resolve(ffmpegPathInput);
  const ffprobePath = path.resolve(ffprobePathInput);
  const nodePath = path.resolve(nodePathInput);
  const appManifest = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const appVersion = typeof appManifest.version === 'string' ? appManifest.version : '';
  if (!appVersion) fail('App version is unavailable.');
  const [projectStat, voiceStat] = await Promise.all([
    fs.lstat(projectRoot),
    fs.lstat(voiceRoot),
  ]);
  if (
    projectStat.isSymbolicLink()
    || !projectStat.isDirectory()
    || voiceStat.isSymbolicLink()
    || !voiceStat.isDirectory()
  ) {
    fail('Project and voice inputs must be trusted directories.');
  }

  await Promise.all([
    fileEvidence(browserPath),
    fileEvidence(ffmpegPath),
    fileEvidence(ffprobePath),
    fileEvidence(nodePath),
  ]);
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
  process.env.STARIZZI_FFMPEG_BIN = ffmpegPath;
  process.env.STARIZZI_FFPROBE_BIN = ffprobePath;
  delete process.env.STARIZZI_HYPERFRAMES_NODE;
  process.env.STARIZZI_HYPERFRAMES_BROWSER = browserPath;

  const workspaceId = 'customer-' + createHash('sha256')
    .update(projectRoot + runtimeRoot)
    .digest('hex')
    .slice(0, 12);
  const runtimeScratchParent = await fs.realpath(os.tmpdir());
  const scratchBefore = new Set(await runtimeScratchDirectories(runtimeScratchParent));
  let openedPath = '';
  const service = new CustomerVideoStudioService({
    rootPath: runtimeRoot,
    appRoot,
    managedBrowserPath: browserPath,
    runtimeScratchParent,
    videoRenderNodePath: nodePath,
    openLocalFile: async (candidate) => {
      openedPath = candidate;
      return '';
    },
  });
  for (const methodName of ['runHyperframesRender', 'runFfmpegMux', 'probeVideoPreview']) {
    const original = service[methodName].bind(service);
    service[methodName] = async (...args) => {
      try {
        return await original(...args);
      } catch (error) {
        smokeDiagnostic = {
          stage: methodName,
          code: error && error.code,
          exitCode: error && error.exitCode,
          message: error instanceof Error ? error.message : String(error),
          stdoutTail: typeof (error && error.stdout) === 'string'
            ? error.stdout.slice(-2_000)
            : undefined,
          stderrTail: typeof (error && error.stderr) === 'string'
            ? error.stderr.slice(-2_000)
            : undefined,
        };
        throw error;
      }
    };
  }

  try {
    const toolchain = await service.getToolchain();
    if (!toolchain.previewAvailable || toolchain.ffmpeg.status !== 'ready') {
      fail('Managed video preview toolchain is unavailable: ' + JSON.stringify(toolchain));
    }
    if (toolchain.commercialRenderAvailable) {
      fail('Managed Electron must keep commercial render disabled.');
    }

    const imported = await service.importProject(workspaceId, projectRoot);
    const voiceGeneratedAt = new Date().toISOString();
    const voiceRunId = voiceGeneratedAt
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      + '-'
      + createHash('sha256').update(runtimeRoot).digest('hex').slice(0, 16);
    const voiceOutputRoot = path.join(
      runtimeRoot,
      workspaceId,
      'preview-runs',
      imported.runtimeProjectId,
      voiceRunId,
      'voice-preview',
    );
    const voiceArtifacts = await copyVerifiedVoiceArtifacts(voiceRoot, voiceOutputRoot);
    const preview = await service.createVideoPreview(
      workspaceId,
      imported.runtimeProjectId,
      imported.evidenceDigest,
      voiceRunId,
      voiceGeneratedAt,
      voiceArtifacts,
    );
    await service.openVideoPreview(
      workspaceId,
      imported.runtimeProjectId,
      imported.evidenceDigest,
      preview.receipt.runId,
      preview.receipt.generatedAt,
      preview.artifacts[0],
    );
    if (!openedPath) fail('Verified local video path was not resolved.');
    const outputEvidence = await fileEvidence(openedPath);
    if (
      outputEvidence.sha256 !== preview.artifacts[0].sha256
      || outputEvidence.sizeBytes !== preview.artifacts[0].sizeBytes
    ) {
      fail('Video artifact evidence does not match the retained MP4.');
    }

    const scratchAfter = await runtimeScratchDirectories(runtimeScratchParent);
    const leakedScratchDirectories = scratchAfter.filter((entry) => !scratchBefore.has(entry));
    if (leakedScratchDirectories.length > 0) {
      fail('Managed video preview left a runtime scratch directory behind.');
    }

    const report = {
      status: 'pass',
      customerProof: 'local_managed_windows_x64_video_preview',
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      appVersion,
      hyperframesVersion: toolchain.hyperframes.version,
      ffmpegVersion: toolchain.ffmpeg.version,
      runtimeSource: 'managed_electron',
      workspaceId,
      runtimeProjectId: imported.runtimeProjectId,
      evidenceDigest: imported.evidenceDigest,
      voiceArtifacts,
      receipt: preview.receipt,
      artifact: preview.artifacts[0],
      outputEvidence,
      outputPathResolved: true,
      runtimeScratchClean: true,
      commercialRenderAvailable: toolchain.commercialRenderAvailable,
      externalActionsPerformed: false,
    };
    await fs.writeFile(
      path.join(runtimeRoot, 'managed-video-preview-report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );
    process.stdout.write(JSON.stringify(report, null, 2));
  } finally {
    service.killAll();
  }
}

main().catch((error) => {
  const report = {
    status: 'fail',
    error: error instanceof Error ? error.message : 'Unknown managed video preview failure.',
    diagnostic: smokeDiagnostic,
    externalActionsPerformed: false,
  };
  const runtimeRootInput = process.argv[5];
  const persist = runtimeRootInput
    ? fs.writeFile(
      path.join(path.resolve(runtimeRootInput), 'managed-video-preview-report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    ).catch(() => undefined)
    : Promise.resolve();
  void persist.finally(() => {
    process.stderr.write(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  });
});
