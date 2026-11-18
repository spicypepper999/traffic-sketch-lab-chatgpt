import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');

test('package version, product labels, changelog, and launcher version stay in sync',()=>{
  const version=JSON.parse(read('package.json')).version;
  const short=version.split('.').slice(0,2).join('.');
  assert.match(read('README.md'),new RegExp(`Current version:.*v${version.replaceAll('.','\\.')}`));
  assert.ok(read('CHANGELOG.md').includes(`## v${version} —`));
  assert.ok(read('index.html').includes(`ALPHA ${short}`));
  assert.ok(read('launcher/main.go').includes(`v${version}`));
  assert.ok(read('launcher/README-Windows.txt').includes(`v${version}`));
});
