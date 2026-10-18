import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const serverDir = path.join(root, 'src', 'server');
const serverFiles = [
  path.join(root, 'server.ts'),
  ...fs
    .readdirSync(serverDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(serverDir, f)),
];

test('the mock data module is gone', () => {
  assert.equal(fs.existsSync(path.join(root, 'src', 'data', 'mockData.ts')), false);
});

test('server source contains no Math.random and no seed/demo markers', () => {
  assert.ok(serverFiles.length > 3);
  const markers: [string, RegExp][] = [
    ['Math.random(', /Math\.random\s*\(/],
    ["evidenceLabel 'DEMO'", /evidenceLabel\s*:\s*['"`]DEMO['"`]/],
    ['example.invalid', /example\.invalid/i],
    ['Demo Provider', /Demo Provider/i],
    ['Demo Node', /Demo Node/i],
    ['mockData import', /mockData/],
  ];
  const hits: string[] = [];
  for (const file of serverFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [label, re] of markers) {
      src.split('\n').forEach((line, i) => {
        if (re.test(line)) hits.push(`${path.relative(root, file)}:${i + 1} ${label}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});
