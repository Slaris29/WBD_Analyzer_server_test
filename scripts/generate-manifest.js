// WBD Analyzer server CSV manifest + bundle generator
// 사용법: node scripts/generate-manifest.js
//
// data 폴더 아래의 .csv/.txt 파일을 자동으로 훑어서 data/manifest.json 생성
// 추가로 data/_bundles/*.json 묶음 파일을 생성합니다.
// 분석기는 묶음 파일이 있으면 그룹당 1회 요청으로 CSV들을 받아 로딩 속도가 빨라집니다.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUT_FILE = path.join(DATA_DIR, 'manifest.json');
const BUNDLE_DIR = path.join(DATA_DIR, '_bundles');
const ACCEPT_EXT = new Set(['.csv', '.txt']);

const CATEGORY_NAMES = {
  league: '리그전',
  scrim: '일반 스크림',
  independent: '독립팀',
  event: '이벤트리그',
  etc: '기타',
};
const CATEGORY_ORDER = ['league', 'scrim', 'independent', 'event', 'etc'];

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function toPosix(p) { return p.split(path.sep).join('/'); }
function isAcceptedFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ACCEPT_EXT.has(ext) && fileName !== 'manifest.json';
}
function rmDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    fs.rmSync(full, { recursive: true, force: true });
  }
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === '_bundles') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && isAcceptedFile(entry.name)) out.push(full);
  }
  return out;
}
function niceNameFromPathPart(part) {
  return String(part || '').replace(/\.(csv|txt)$/i, '').replace(/_/g, ' ').trim();
}
function fileToItem(full) {
  const rel = toPosix(path.relative(ROOT, full));
  const st = fs.statSync(full);
  const base = path.basename(full).replace(/\.(csv|txt)$/i, '');
  return { name: base, path: rel, size: st.size, updatedAt: st.mtime.toISOString() };
}
function groupKeyFromFile(full) {
  const relFromData = toPosix(path.relative(DATA_DIR, full));
  const parts = relFromData.split('/');
  const category = CATEGORY_NAMES[parts[0]] ? parts[0] : 'etc';
  const hasSubFolder = CATEGORY_NAMES[parts[0]] && parts.length >= 3;
  const subgroupParts = hasSubFolder ? parts.slice(1, -1) : [];
  const subgroup = subgroupParts.join('/');
  if (subgroup) return {
    id: `${category}/${subgroup}`,
    name: subgroupParts.map(niceNameFromPathPart).join(' / '),
    category,
    categoryName: CATEGORY_NAMES[category],
    description: CATEGORY_NAMES[category],
  };
  return { id: category, name: CATEGORY_NAMES[category], category, categoryName: CATEGORY_NAMES[category], description: '' };
}
function sortGroups(a, b) {
  const ai = CATEGORY_ORDER.indexOf(a.category), bi = CATEGORY_ORDER.indexOf(b.category);
  const ao = ai === -1 ? 999 : ai, bo = bi === -1 ? 999 : bi;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name, 'ko');
}
function safeBundleName(id) {
  return String(id).replace(/[^a-zA-Z0-9가-힣_-]+/g, '__').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'bundle';
}
function createBundle(group) {
  ensureDir(BUNDLE_DIR);
  const bundleName = safeBundleName(group.id) + '.bundle.json';
  const bundlePath = path.join(BUNDLE_DIR, bundleName);
  const bundleRel = toPosix(path.relative(ROOT, bundlePath));
  const files = group.files.map(item => {
    const full = path.join(ROOT, item.path);
    return { ...item, text: fs.readFileSync(full, 'utf8') };
  });
  const bundle = { version: 1, groupId: group.id, groupName: group.name, generatedAt: new Date().toISOString(), files };
  fs.writeFileSync(bundlePath, JSON.stringify(bundle), 'utf8');
  const st = fs.statSync(bundlePath);
  return { path: bundleRel, size: st.size, fileCount: files.length, updatedAt: st.mtime.toISOString() };
}
function main() {
  ensureDir(DATA_DIR);
  for (const c of CATEGORY_ORDER) ensureDir(path.join(DATA_DIR, c));
  ensureDir(BUNDLE_DIR);
  rmDirContents(BUNDLE_DIR);

  const files = walk(DATA_DIR).sort((a, b) => toPosix(a).localeCompare(toPosix(b), 'ko'));
  const grouped = new Map();
  for (const full of files) {
    const meta = groupKeyFromFile(full);
    if (!grouped.has(meta.id)) grouped.set(meta.id, { ...meta, files: [] });
    grouped.get(meta.id).files.push(fileToItem(full));
  }
  const groups = [...grouped.values()].sort(sortGroups).map(g => {
    const sortedFiles = g.files.sort((a, b) => a.path.localeCompare(b.path, 'ko'));
    const group = { id: g.id, name: g.name, category: g.category, categoryName: g.categoryName, description: g.description, default: true, files: sortedFiles };
    group.bundle = createBundle(group);
    return group;
  });
  const manifest = { version: 3, generatedAt: new Date().toISOString(), bundleMode: true, categoryOrder: CATEGORY_ORDER, categories: CATEGORY_NAMES, groups };
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✅ manifest generated: ${groups.length} groups / ${files.length} files -> ${toPosix(path.relative(ROOT, OUT_FILE))}`);
  console.log(`✅ bundles generated: ${groups.length} -> ${toPosix(path.relative(ROOT, BUNDLE_DIR))}`);
}
main();
