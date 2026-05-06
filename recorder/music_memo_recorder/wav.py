from __future__ import annotations

from dataclasses import dataclass
import math
import struct


@dataclass(frozen=True)
class WavInfo:
    duration_seconds: float
    sample_rate: int
    channel_count: int
    byte_count: int


def _find_chunk(data: bytes, chunk_id: bytes) -> tuple[int, int] | None:
    offset = 12
    while offset + 8 <= len(data):
        current_id = data[offset : offset + 4]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        data_offset = offset + 8
        if data_offset + size > len(data):
            return None
        if current_id == chunk_id:
            return data_offset, size
        offset += 8 + size + (size % 2)
    return None


def read_wav_info(data: bytes) -> WavInfo:
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("audio must be a WAV file")

    fmt = _find_chunk(data, b"fmt ")
    pcm = _find_chunk(data, b"data")
    if fmt is None or pcm is None:
        raise ValueError("WAV is missing fmt or data chunks")

    fmt_offset, _fmt_size = fmt
    data_offset, data_size = pcm
    channel_count = struct.unpack_from("<H", data, fmt_offset + 2)[0]
    sample_rate = struct.unpack_from("<I", data, fmt_offset + 4)[0]
    byte_rate = struct.unpack_from("<I", data, fmt_offset + 8)[0]
    if channel_count < 1 or sample_rate < 1 or byte_rate < 1 or data_size < 1:
        raise ValueError("WAV has invalid stream metadata")
    if data_offset + data_size > len(data):
        raise ValueError("WAV data chunk is truncated")

    return WavInfo(
        duration_seconds=round(data_size / byte_rate, 3),
        sample_rate=sample_rate,
        channel_count=channel_count,
        byte_count=len(data),
    )


def make_sine_wav(
    duration_seconds: float,
    sample_rate: int = 16_000,
    channel_count: int = 1,
    frequency: float = 220.0,
) -> bytes:
    bytes_per_sample = 2
    block_align = channel_count * bytes_per_sample
    byte_rate = sample_rate * block_align
    sample_count = max(1, int(duration_seconds * sample_rate))
    data_size = sample_count * block_align
    header = bytearray(44)

    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + data_size)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)
    struct.pack_into("<H", header, 22, channel_count)
    struct.pack_into("<I", header, 24, sample_rate)
    struct.pack_into("<I", header, 28, byte_rate)
    struct.pack_into("<H", header, 32, block_align)
    struct.pack_into("<H", header, 34, 16)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, data_size)

    body = bytearray(data_size)
    for sample_index in range(sample_count):
        t = sample_index / sample_rate
        attack = min(1.0, t / 0.05)
        release = min(1.0, max(0.0, (duration_seconds - t) / 0.05))
        sample = int(math.sin(2 * math.pi * frequency * t) * attack * release * 16_000)
        for channel in range(channel_count):
            offset = sample_index * block_align + channel * bytes_per_sample
            struct.pack_into("<h", body, offset, sample)

    return bytes(header + body)
