"""Strict validation for WAV data returned by the local TTS runtime."""

import struct


MAX_AUDIO_BYTES = 8 * 1024 * 1024
PCM_CHANNELS = 1
PCM_SAMPLE_RATE = 48_000
PCM_BITS_PER_SAMPLE = 16
PCM_BLOCK_ALIGN = PCM_CHANNELS * PCM_BITS_PER_SAMPLE // 8
PCM_BYTE_RATE = PCM_SAMPLE_RATE * PCM_BLOCK_ALIGN


def valid_wav(data: bytes) -> bool:
    if len(data) < 44 or len(data) > MAX_AUDIO_BYTES:
        return False
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return False

    riff_end = struct.unpack_from("<I", data, 4)[0] + 8
    if riff_end != len(data) or riff_end < 44:
        return False

    offset = 12
    has_format = False
    has_data = False
    while offset + 8 <= riff_end:
        chunk_id = data[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", data, offset + 4)[0]
        data_start = offset + 8
        data_end = data_start + chunk_size
        padded_end = data_end + (chunk_size % 2)
        if data_end > riff_end or padded_end > riff_end:
            return False
        if chunk_id == b"fmt ":
            if has_format or chunk_size < 16:
                return False
            audio_format, channels, sample_rate, byte_rate, block_align, bits_per_sample = (
                struct.unpack_from("<HHIIHH", data, data_start)
            )
            if (
                audio_format != 1
                or channels != PCM_CHANNELS
                or sample_rate != PCM_SAMPLE_RATE
                or byte_rate != PCM_BYTE_RATE
                or block_align != PCM_BLOCK_ALIGN
                or bits_per_sample != PCM_BITS_PER_SAMPLE
            ):
                return False
            has_format = True
        elif chunk_id == b"data":
            if has_data or chunk_size == 0 or chunk_size % PCM_BLOCK_ALIGN != 0:
                return False
            has_data = True
        offset = padded_end
    return offset == riff_end and has_format and has_data
