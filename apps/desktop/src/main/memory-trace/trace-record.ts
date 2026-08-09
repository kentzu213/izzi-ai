// CMR-224 Slice 3 — the stored shape of a trace unit.
//
// Kept separate from both the DB manager and the store so the two can agree on
// one row shape without either importing the other's behaviour.
//
// The schema enforces the classification policy as well as exclusivity:
// public metadata uses `text_plain`; every private class uses `text_cipher`.
// A caller cannot choose plaintext for a class that requires encryption.

export interface MemoryTraceUnitRow {
  readonly id: string;
  readonly schema_version: number;
  readonly actor: string;
  readonly classification: string;
  readonly text_plain: string | null;
  readonly text_cipher: string | null;
  readonly source_id: string;
  readonly source_kind: string;
  readonly boundary_id: string;
  readonly observed_at: string;
  /** When this row was appended, which may be later than `observed_at`. */
  readonly recorded_at: string;
}
