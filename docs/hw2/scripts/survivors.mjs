// Lists surviving / uncovered mutants from a Stryker JSON report, grouped by
// file, so they can be pasted to the coding agent as feedback.
// Usage: node docs/hw2/scripts/survivors.mjs server/reports/mutation/mutation.json [file-filter]
import fs from 'node:fs';

const [, , reportPath, filter = ''] = process.argv;
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

for (const [file, { source, mutants }] of Object.entries(report.files)) {
  if (!file.includes(filter)) continue;
  const lines = source.split('\n');
  const bad = mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');
  if (!bad.length) continue;
  console.log(`\n## ${file} (${bad.length} undetected)`);
  for (const m of bad.sort((a, b) => a.location.start.line - b.location.start.line)) {
    const line = m.location.start.line;
    const code = lines[line - 1].trim().slice(0, 90);
    console.log(`  L${line} [${m.status === 'NoCoverage' ? 'no-cov' : 'survived'}] ${m.mutatorName}: ${JSON.stringify(m.replacement ?? '').slice(0, 70)}   | ${code}`);
  }
}
