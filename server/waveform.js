import fs from 'node:fs/promises';

const defaultMinBuckets = 180;
const defaultMaxBuckets = 1200;
const targetBucketsPerSecond = 4;

export class WavFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WavFormatError';
    this.status = 400;
  }
}

export function findWavChunk(buffer, chunkId) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) {
      throw new WavFormatError('WAV chunk data is truncated');
    }
    if (id === chunkId) {
      return { offset: dataOffset, size, sizeOffset: offset + 4 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

function assertSupportedWav(details) {
  const supportedPcm =
    details.audio_format === 1 &&
    [8, 16, 24, 32].includes(details.bits_per_sample);
  const supportedFloat =
    details.audio_format === 3 && details.bits_per_sample === 32;

  if (!supportedPcm && !supportedFloat) {
    throw new WavFormatError(
      'WAV audio must be PCM integer or 32-bit float samples',
    );
  }
}

function detailsFromFmtAndData({
  byteCount,
  fmtBuffer,
  dataOffset,
  dataSize,
}) {
  if (fmtBuffer.length < 16) {
    throw new WavFormatError('WAV fmt chunk is invalid');
  }

  const audioFormat = fmtBuffer.readUInt16LE(0);
  const channelCount = fmtBuffer.readUInt16LE(2);
  const sampleRate = fmtBuffer.readUInt32LE(4);
  const byteRate = fmtBuffer.readUInt32LE(8);
  const blockAlign = fmtBuffer.readUInt16LE(12);
  const bitsPerSample = fmtBuffer.readUInt16LE(14);
  const bytesPerSample = bitsPerSample / 8;

  if (
    channelCount < 1 ||
    sampleRate < 1 ||
    byteRate < 1 ||
    blockAlign < 1 ||
    dataSize < 1 ||
    !Number.isInteger(bytesPerSample) ||
    bytesPerSample < 1
  ) {
    throw new WavFormatError('WAV audio has invalid stream metadata');
  }
  if (blockAlign !== channelCount * bytesPerSample) {
    throw new WavFormatError('WAV block alignment is invalid');
  }
  if (byteRate !== sampleRate * blockAlign) {
    throw new WavFormatError('WAV byte rate is invalid');
  }

  const totalFrames = Math.floor(dataSize / blockAlign);
  if (totalFrames < 1) {
    throw new WavFormatError('WAV audio has no complete sample frames');
  }

  const details = {
    duration_seconds: Number((dataSize / byteRate).toFixed(3)),
    sample_rate: sampleRate,
    channel_count: channelCount,
    byte_count: byteCount,
    audio_format: audioFormat,
    bits_per_sample: bitsPerSample,
    block_align: blockAlign,
    byte_rate: byteRate,
    data_offset: dataOffset,
    data_size: dataSize,
    total_frames: totalFrames,
  };
  assertSupportedWav(details);
  return details;
}

export function readWavInfo(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new WavFormatError('Only WAV audio can be imported');
  }

  const fmt = findWavChunk(buffer, 'fmt ');
  const data = findWavChunk(buffer, 'data');
  if (!fmt || !data) {
    throw new WavFormatError('WAV audio is missing fmt or data chunks');
  }

  return detailsFromFmtAndData({
    byteCount: buffer.length,
    fmtBuffer: buffer.subarray(fmt.offset, fmt.offset + fmt.size),
    dataOffset: data.offset,
    dataSize: data.size,
  });
}

async function readExactly(handle, buffer, position, label) {
  const { bytesRead } = await handle.read(
    buffer,
    0,
    buffer.length,
    position,
  );
  if (bytesRead !== buffer.length) {
    throw new WavFormatError(`WAV ${label} is truncated`);
  }
}

export async function readWavFileInfo(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < 44) {
      throw new WavFormatError('Only WAV audio can be imported');
    }

    const riff = Buffer.alloc(12);
    await readExactly(handle, riff, 0, 'header');
    if (
      riff.toString('ascii', 0, 4) !== 'RIFF' ||
      riff.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new WavFormatError('Only WAV audio can be imported');
    }

    let offset = 12;
    let fmtBuffer = null;
    let dataOffset = null;
    let dataSize = null;
    const chunkHeader = Buffer.alloc(8);

    while (offset + 8 <= stat.size) {
      await readExactly(handle, chunkHeader, offset, 'chunk header');
      const id = chunkHeader.toString('ascii', 0, 4);
      const size = chunkHeader.readUInt32LE(4);
      const nextDataOffset = offset + 8;
      if (nextDataOffset + size > stat.size) {
        throw new WavFormatError('WAV chunk data is truncated');
      }

      if (id === 'fmt ') {
        fmtBuffer = Buffer.alloc(size);
        await readExactly(handle, fmtBuffer, nextDataOffset, 'fmt chunk');
      } else if (id === 'data') {
        dataOffset = nextDataOffset;
        dataSize = size;
      }

      if (fmtBuffer && dataOffset !== null && dataSize !== null) {
        break;
      }
      offset = nextDataOffset + size + (size % 2);
    }

    if (!fmtBuffer || dataOffset === null || dataSize === null) {
      throw new WavFormatError('WAV audio is missing fmt or data chunks');
    }

    return detailsFromFmtAndData({
      byteCount: stat.size,
      fmtBuffer,
      dataOffset,
      dataSize,
    });
  } finally {
    await handle.close();
  }
}

function waveformBucketCount(durationSeconds) {
  return Math.min(
    defaultMaxBuckets,
    Math.max(
      defaultMinBuckets,
      Math.ceil(durationSeconds * targetBucketsPerSecond),
    ),
  );
}

function sampleMagnitude(buffer, offset, details) {
  if (details.audio_format === 3) {
    return Math.min(1, Math.abs(buffer.readFloatLE(offset)));
  }

  switch (details.bits_per_sample) {
    case 8:
      return Math.abs(buffer.readUInt8(offset) - 128) / 128;
    case 16:
      return Math.abs(buffer.readInt16LE(offset)) / 32768;
    case 24:
      return Math.abs(buffer.readIntLE(offset, 3)) / 8388608;
    case 32:
      return Math.abs(buffer.readInt32LE(offset)) / 2147483648;
    default:
      throw new WavFormatError('WAV bit depth is unsupported');
  }
}

function addFramePeak(peaks, frameIndex, totalFrames, framePeak) {
  const bucketIndex = Math.min(
    peaks.length - 1,
    Math.floor((frameIndex * peaks.length) / totalFrames),
  );
  peaks[bucketIndex] = Math.max(peaks[bucketIndex], framePeak);
}

function roundedPeaks(peaks) {
  return peaks.map((peak) => Number(Math.min(1, peak).toFixed(4)));
}

function buildWaveformCache(sessionId, details, peaks, source) {
  return {
    session_id: sessionId,
    generated_at: new Date().toISOString(),
    source,
    bucket_count: peaks.length,
    peaks: roundedPeaks(peaks),
  };
}

export function generateWaveformFromWavBuffer(buffer, sessionId) {
  const details = readWavInfo(buffer);
  const bucketCount = waveformBucketCount(details.duration_seconds);
  const peaks = Array.from({ length: bucketCount }, () => 0);
  const bytesPerSample = details.bits_per_sample / 8;

  for (
    let frameIndex = 0, offset = details.data_offset;
    frameIndex < details.total_frames;
    frameIndex += 1, offset += details.block_align
  ) {
    let framePeak = 0;
    for (let channel = 0; channel < details.channel_count; channel += 1) {
      const sampleOffset = offset + channel * bytesPerSample;
      framePeak = Math.max(framePeak, sampleMagnitude(buffer, sampleOffset, details));
    }
    addFramePeak(peaks, frameIndex, details.total_frames, framePeak);
  }

  return buildWaveformCache(sessionId, details, peaks, 'manager_wav_peak_v1');
}

export async function generateWaveformFromWavFile(filePath, sessionId) {
  const details = await readWavFileInfo(filePath);
  const bucketCount = waveformBucketCount(details.duration_seconds);
  const peaks = Array.from({ length: bucketCount }, () => 0);
  const bytesPerSample = details.bits_per_sample / 8;
  const handle = await fs.open(filePath, 'r');

  try {
    const chunkSize = 1024 * 1024;
    let fileOffset = details.data_offset;
    let remaining = details.data_size;
    let frameIndex = 0;
    let carry = Buffer.alloc(0);

    while (remaining > 0) {
      const readSize = Math.min(chunkSize, remaining);
      const chunk = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(chunk, 0, readSize, fileOffset);
      if (bytesRead < 1) {
        throw new WavFormatError('WAV data chunk is truncated');
      }

      const data = carry.length
        ? Buffer.concat([carry, chunk.subarray(0, bytesRead)])
        : chunk.subarray(0, bytesRead);
      const completeBytes =
        Math.floor(data.length / details.block_align) * details.block_align;

      for (
        let offset = 0;
        offset < completeBytes && frameIndex < details.total_frames;
        offset += details.block_align
      ) {
        let framePeak = 0;
        for (let channel = 0; channel < details.channel_count; channel += 1) {
          const sampleOffset = offset + channel * bytesPerSample;
          framePeak = Math.max(
            framePeak,
            sampleMagnitude(data, sampleOffset, details),
          );
        }
        addFramePeak(peaks, frameIndex, details.total_frames, framePeak);
        frameIndex += 1;
      }

      carry = data.subarray(completeBytes);
      fileOffset += bytesRead;
      remaining -= bytesRead;
    }

    if (frameIndex !== details.total_frames) {
      throw new WavFormatError('WAV data chunk has incomplete sample frames');
    }

    return buildWaveformCache(sessionId, details, peaks, 'manager_wav_peak_v1');
  } finally {
    await handle.close();
  }
}
