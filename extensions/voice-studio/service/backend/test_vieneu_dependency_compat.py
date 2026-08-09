import base64
import csv
import hashlib
import tempfile
import unittest
from pathlib import Path

from vieneu_dependency_compat import (
    ERRONEOUS_REQUIREMENT,
    PATCH_MARKER,
    patch_metadata_files,
)


class VieneuDependencyCompatibilityTests(unittest.TestCase):
    def test_removes_only_the_known_optional_requirement_and_updates_record(self):
        with tempfile.TemporaryDirectory() as temp:
            dist_info = Path(temp) / 'vieneu-3.2.3.dist-info'
            dist_info.mkdir()
            metadata = dist_info / 'METADATA'
            record = dist_info / 'RECORD'
            metadata.write_text(
                '\n'.join(
                    [
                        'Metadata-Version: 2.4',
                        'Name: vieneu',
                        'Version: 3.2.3',
                        ERRONEOUS_REQUIREMENT,
                        'Requires-Dist: numpy',
                        '',
                        'VieNeu',
                    ]
                ),
                encoding='utf-8',
            )
            record.write_text(
                'vieneu-3.2.3.dist-info/METADATA,sha256=old,1\n'
                'vieneu-3.2.3.dist-info/RECORD,,\n',
                encoding='utf-8',
            )

            self.assertTrue(patch_metadata_files(metadata, record))
            self.assertFalse(patch_metadata_files(metadata, record))

            patched_bytes = metadata.read_bytes()
            patched_text = patched_bytes.decode('utf-8')
            self.assertNotIn(ERRONEOUS_REQUIREMENT, patched_text)
            self.assertIn(PATCH_MARKER, patched_text)
            self.assertIn('Requires-Dist: numpy', patched_text)

            rows = list(csv.reader(record.read_text(encoding='utf-8').splitlines()))
            metadata_row = rows[0]
            digest = base64.urlsafe_b64encode(hashlib.sha256(patched_bytes).digest()).rstrip(b'=')
            self.assertEqual(metadata_row[1], 'sha256=' + digest.decode('ascii'))
            self.assertEqual(metadata_row[2], str(len(patched_bytes)))

    def test_fails_closed_when_upstream_metadata_drifts(self):
        with tempfile.TemporaryDirectory() as temp:
            dist_info = Path(temp) / 'vieneu-3.2.3.dist-info'
            dist_info.mkdir()
            metadata = dist_info / 'METADATA'
            record = dist_info / 'RECORD'
            metadata.write_text(
                'Metadata-Version: 2.4\nName: vieneu\nVersion: 3.2.3\n',
                encoding='utf-8',
            )
            record.write_text(
                'vieneu-3.2.3.dist-info/METADATA,sha256=old,1\n',
                encoding='utf-8',
            )

            with self.assertRaisesRegex(RuntimeError, 'vieneu_perth_requirement_drift'):
                patch_metadata_files(metadata, record)


if __name__ == '__main__':
    unittest.main()
