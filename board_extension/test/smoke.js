// Runs the compiled board logic against the real JIRA site, outside the editor.
//   npm run compile && node test/smoke.js
require('./stub-vscode');
const { fetchBoard, fetchDetail, COLUMNS } = require('../out/board');

(async () => {
  const tickets = await fetchBoard();
  console.log('board ->', tickets.length, 'cards');
  for (const column of COLUMNS) {
    const n = tickets.filter((t) => t.status === column).length;
    console.log(`  ${String(n).padStart(3)}  ${column}`);
  }

  const sample = tickets[0];
  if (!sample) {
    console.log('no tickets; nothing else to check');
    return;
  }
  const detail = await fetchDetail(sample.key);
  console.log(`\n${sample.key}  ${sample.summary.slice(0, 50)}`);
  console.log('  labels   :', JSON.stringify(detail.labels));
  console.log('  hasPrd   :', detail.hasPrd);
  console.log('  subtasks :', detail.subtasks.length);
  console.log('  timeline :', detail.timeline.length, 'entries');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
