import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildExperimentalHtml } from './transform.mjs';
const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const runtime = await readFile(new URL('./runtime.js', import.meta.url), 'utf8');

test('experimental page compiles without changing the original document', () => {
  const generated = buildExperimentalHtml(source, runtime);
  assert.ok(!source.includes('const nr = { active:'));
  assert.ok(generated.includes('const nr = { active:'));
  assert.ok(generated.includes('/experimental-rules/style.css'));
  for (const match of generated.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new Function(match[1]);
  }
});

test('upstream source drift fails closed instead of serving partial rules', () => {
  assert.throws(() => buildExperimentalHtml(source.replace('    window.__chibattle = {', '    window.API = {'), runtime), /変更位置が一致しません/);
});

test('original card stats and pending-adjustment definitions are unchanged', () => {
  const generated = buildExperimentalHtml(source, runtime);
  for (const id of ['loud_group', 'aiben', 'nyotei', 'rear_queen', 'contrarian_portal', 'aggro_kingdom']) {
    const definition = source.match(new RegExp(`^      ${id}: \\{[^\\n]+`, 'm'))?.[0];
    assert.ok(definition, id);
    assert.ok(generated.includes(definition), id);
  }
});
