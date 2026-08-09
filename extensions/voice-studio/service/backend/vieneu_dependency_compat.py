'''Audited compatibility patch for VieNeu 3.2.3's optional Perth metadata.'''

from __future__ import annotations

import base64
import csv
import hashlib
import importlib.util
import io
from importlib.metadata import Distribution, distribution
from pathlib import Path


PINNED_VIENEU_VERSION = '3.2.3'
ERRONEOUS_REQUIREMENT = 'Requires-Dist: perth>=0.2.0'
PATCH_MARKER = 'X-Izzi-Compatibility: optional-perth-metadata-removed'


def _record_digest(data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b'=')
    return 'sha256=' + digest.decode('ascii')


def patch_metadata_files(metadata_path: Path, record_path: Path) -> bool:
    '''Remove exactly one known-bad requirement and keep RECORD consistent.'''
    metadata_text = metadata_path.read_text(encoding='utf-8')
    if PATCH_MARKER in metadata_text:
        if ERRONEOUS_REQUIREMENT in metadata_text:
            raise RuntimeError('vieneu_perth_patch_inconsistent')
        return False
    if metadata_text.count(ERRONEOUS_REQUIREMENT) != 1:
        raise RuntimeError('vieneu_perth_requirement_drift')

    patched_text = metadata_text.replace(ERRONEOUS_REQUIREMENT, PATCH_MARKER, 1)
    patched_bytes = patched_text.encode('utf-8')

    rows = list(csv.reader(io.StringIO(record_path.read_text(encoding='utf-8'))))
    metadata_record_path = f'{record_path.parent.name}/METADATA'
    matching_rows = [row for row in rows if row and row[0].replace('\\', '/') == metadata_record_path]
    if len(matching_rows) != 1:
        raise RuntimeError('vieneu_metadata_record_missing')
    matching_rows[0][1] = _record_digest(patched_bytes)
    matching_rows[0][2] = str(len(patched_bytes))

    record_buffer = io.StringIO(newline='')
    writer = csv.writer(record_buffer, lineterminator='\n')
    writer.writerows(rows)

    metadata_path.write_bytes(patched_bytes)
    record_path.write_text(record_buffer.getvalue(), encoding='utf-8', newline='')
    return True


def _dist_info_file(dist: Distribution, filename: str) -> Path:
    matches = [
        Path(dist.locate_file(file))
        for file in (dist.files or [])
        if str(file).replace('\\', '/').endswith(f'.dist-info/{filename}')
    ]
    if len(matches) != 1:
        raise RuntimeError(f'vieneu_{filename.lower()}_path_invalid')
    return matches[0]


def patch_installed_vieneu() -> None:
    dist = distribution('vieneu')
    if dist.version != PINNED_VIENEU_VERSION:
        raise RuntimeError('vieneu_version_mismatch')
    if importlib.util.find_spec('perth') is not None:
        raise RuntimeError('unexpected_perth_module')

    metadata_path = _dist_info_file(dist, 'METADATA')
    record_path = _dist_info_file(dist, 'RECORD')
    patch_metadata_files(metadata_path, record_path)

    patched = metadata_path.read_text(encoding='utf-8')
    if ERRONEOUS_REQUIREMENT in patched or PATCH_MARKER not in patched:
        raise RuntimeError('vieneu_perth_patch_failed')


if __name__ == '__main__':
    patch_installed_vieneu()
    print('VieNeu optional Perth metadata compatibility patch verified.')
