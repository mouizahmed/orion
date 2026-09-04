const { spawnSync } = require('node:child_process')
const { constants } = require('node:fs')
const { access, open, realpath, stat } = require('node:fs/promises')
const path = require('node:path')

const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']
const MAX_EXECUTABLE_HEADER_BYTES = 4096
const MAX_FFMPEG_OUTPUT_BYTES = 4 * 1024 * 1024

exports.default = async function prepareAudioRuntime(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch]
  assertSupportedTarget(platform, arch)

  const projectDirectory = context.packager.projectDir
  const executableSuffix = platform === 'win32' ? '.exe' : ''
  const helperName = `orion-audio-engine${executableSuffix}`
  const ffmpegName = `ffmpeg${executableSuffix}`
  const configuredHelper = optionalAbsolutePath('ORION_PACKAGED_AUDIO_ENGINE_PATH')

  if (!configuredHelper) buildHelper(projectDirectory)

  const helperPath = await verifyNativeExecutable(
    configuredHelper ?? path.join(projectDirectory, 'native', 'audio-engine', 'target', 'release', helperName),
    platform,
    arch,
    'audio engine helper',
  )
  const ffmpegPath = await verifyNativeExecutable(
    requiredAbsolutePath('ORION_PACKAGED_FFMPEG_PATH'),
    platform,
    arch,
    'FFmpeg',
  )
  verifyLibopusEncoder(ffmpegPath)

  const ffmpegLicensePath = await verifyRegularFile(
    requiredAbsolutePath('ORION_PACKAGED_FFMPEG_LICENSE_PATH'),
    'FFmpeg license',
  )
  const existingResources = asArray(context.packager.config.extraResources)
  context.packager.config.extraResources = [
    ...existingResources,
    { from: helperPath, to: `bin/${helperName}` },
    { from: ffmpegPath, to: `bin/${ffmpegName}` },
    { from: ffmpegLicensePath, to: 'licenses/ffmpeg-LICENSE.txt' },
  ]
}

function assertSupportedTarget(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return
  if (platform === 'darwin' && arch === 'arm64') return
  throw new Error(`Audio runtime packaging does not support ${platform}/${arch ?? 'unknown'}`)
}

function buildHelper(projectDirectory) {
  const cargo = process.env.CARGO?.trim() || 'cargo'
  const result = spawnSync(cargo, ['build', '--release', '--locked'], {
    cwd: path.join(projectDirectory, 'native', 'audio-engine'),
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw new Error(`Could not build packaged audio engine: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Packaged audio engine build exited with code ${result.status ?? 'unknown'}`)
  }
}

async function verifyNativeExecutable(candidate, platform, arch, label) {
  const resolved = await verifyRegularFile(candidate, label)
  await access(resolved, platform === 'win32' ? constants.F_OK : constants.X_OK)
  const header = await readExecutableHeader(resolved)
  if (platform === 'win32') verifyWindowsX64(header, label)
  else verifyMacOsArm64(header, label)
  return resolved
}

async function readExecutableHeader(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(MAX_EXECUTABLE_HEADER_BYTES)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return header.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function verifyRegularFile(candidate, label) {
  let resolved
  try {
    resolved = await realpath(candidate)
  } catch (error) {
    throw new Error(`${label} is unavailable at ${candidate}: ${errorMessage(error)}`)
  }
  const metadata = await stat(resolved)
  if (!metadata.isFile() || metadata.size === 0) throw new Error(`${label} must be a non-empty regular file`)
  return resolved
}

function verifyWindowsX64(contents, label) {
  const header = contents.subarray(0, MAX_EXECUTABLE_HEADER_BYTES)
  if (header.length < 64 || header.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${label} is not a Windows PE executable`)
  }
  const peOffset = header.readUInt32LE(0x3c)
  if (peOffset + 6 > header.length || header.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(`${label} has an invalid Windows PE header`)
  }
  if (header.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error(`${label} is not a Windows x64 executable`)
  }
}

function verifyMacOsArm64(contents, label) {
  const header = contents.subarray(0, MAX_EXECUTABLE_HEADER_BYTES)
  if (
    header.length < 8
    || header.readUInt32LE(0) !== 0xfeedfacf
    || header.readUInt32LE(4) !== 0x0100000c
  ) {
    throw new Error(`${label} is not a thin macOS arm64 Mach-O executable`)
  }
}

function verifyLibopusEncoder(ffmpegPath) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    maxBuffer: MAX_FFMPEG_OUTPUT_BYTES,
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error) throw new Error(`Could not inspect packaged FFmpeg: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Packaged FFmpeg inspection exited with code ${result.status ?? 'unknown'}`)
  if (!/\blibopus\b/.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error('Packaged FFmpeg does not expose the required libopus encoder')
  }
}

function requiredAbsolutePath(name) {
  const value = optionalAbsolutePath(name)
  if (!value) throw new Error(`${name} is required for audio runtime packaging`)
  return value
}

function optionalAbsolutePath(name) {
  const value = process.env[name]?.trim()
  if (!value) return null
  if (!path.isAbsolute(value)) throw new Error(`${name} must be absolute`)
  return value
}

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
