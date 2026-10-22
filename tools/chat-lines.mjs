// Prints every bot chat line in both languages and fails on mismatched pools or unknown placeholders.
// node tools/chat-lines.mjs [de|en]
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { documentElement: {} };
const { LANGS } = await import('../src/i18n.js');
const { SPECIES } = await import('../src/species.js');

const VARS = { gloat: 'kv', salty: 'kv', revenge: 'kv', hacks: 'kv', selfKo: 'kv', bossKill: 'kv', streak: 'kvn', mod: 'kvn', lead: ['n', 'team'] };
const pools = c => Object.entries(c).filter(([, v]) => Array.isArray(v));
const check = (lang, kind, lines) => {
  for (const s of lines) for (const [, k] of s.matchAll(/\{(\w+)\}/g))
    assert([...(VARS[kind] ?? [])].includes(k), `${lang} ${kind}: {${k}} not allowed in "${s}"`);
};

const [de, en] = [LANGS.de.chat, LANGS.en.chat];
assert.deepEqual(pools(de).map(p => p[0]), pools(en).map(p => p[0]), 'de and en have the same pools');
assert.deepEqual(Object.keys(de.voice).sort(), SPECIES.map(s => s.id).sort(), 'de has a voice for every species');
assert.deepEqual(Object.keys(en.voice).sort(), Object.keys(de.voice).sort(), 'en has a voice for every species');

const only = process.argv[2];
for (const [lang, c] of Object.entries(LANGS)) {
  for (const [kind, lines] of pools(c.chat)) check(lang, kind, lines);
  for (const [id, v] of Object.entries(c.chat.voice)) for (const [kind, lines] of Object.entries(v)) check(lang, kind, lines);
  if (only && only !== lang) continue;
  console.log(`\n===== ${lang} =====`);
  for (const [kind, lines] of pools(c.chat)) console.log(`\n[${kind}]\n` + lines.map(s => `  ${s}`).join('\n'));
  for (const [id, v] of Object.entries(c.chat.voice))
    for (const [kind, lines] of Object.entries(v)) console.log(`\n[${c.species[id].name} ${kind}]\n` + lines.map(s => `  ${s}`).join('\n'));
}
console.log('\nchat lines ok');
