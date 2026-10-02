# API duplication gate

The target is at most 3% duplicated maintained production TypeScript. CI uses
lockfile-pinned `jscpd 5.3.1` with a 10-line/70-token minimum and excludes
tests and generated output. The current scan reports 14 legacy clone blocks,
381 duplicated lines out of 12,530 analyzed lines (3.04%). The baseline gate
rejects new clone blocks while the small legacy excess remains documented debt.

To refresh the baseline after a reviewed removal or acceptance of clones, run
the same scan with `--update-baseline` and review the fingerprint change before
committing it. Do not silently raise the threshold or ignore maintained source.
