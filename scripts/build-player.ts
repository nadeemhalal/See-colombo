/**
 * Builds public/models/player.glb: one rigged body, optional extra rigged parts (hair), and only the
 * animation clips the game uses, with textures shrunk for the web.
 *
 *   npm run model -- --anims <animations.glb> [--body <character.gltf|.glb>] [--part <hair.gltf>]... [--out public/models/player.glb]
 *
 * --anims: a glb with the clips. Bones are matched to the body by name; Rigify "DEF-" names (as in
 *          the Quaternius Universal Animation Library) are mapped to Unreal-style names (pelvis,
 *          upperarm_l, ...) when the body uses those.
 * --body:  the character to show. Without it, the mannequin inside the animation file is used.
 * --part:  extra meshes skinned to the same skeleton (hairstyles, beards), merged onto the body.
 * Your own model later: rig it to either naming scheme and pass it as --body.
 */
import { NodeIO, type Animation, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, resample, mergeDocuments, unpartition } from '@gltf-transform/functions';
// keep this sharp on the same version glTF-Transform pulls in (via ndarray-pixels): two copies of
// libvips in one process fail every image with "colourspace: parameter space not set"
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

/** clips the game plays (see src/player/riggedCharacter.ts) */
const KEEP = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Punch_Jab', 'Punch_Cross', 'Driving_Loop', 'Sitting_Idle_Loop',
];

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const argAll = (name: string) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const animsPath = arg('anims');
const bodyPath = arg('body');
const parts = argAll('part');
const outPath = arg('out') ?? 'public/models/player.glb';
if (!animsPath) { console.error('Usage: npm run model -- --anims <file.glb> [--body <file>] [--part <file>]... [--out <file>]'); process.exit(1); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Rigify deform bone name → Unreal-style name */
function toUnreal(name: string): string {
  const side = (s: string) => s.toLowerCase();
  let m: RegExpMatchArray | null;
  const fixed: Record<string, string> = {
    'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03',
    'DEF-neck': 'neck_01', 'DEF-head': 'Head',
  };
  if (fixed[name]) return fixed[name];
  if ((m = name.match(/^DEF-f_(index|middle|pinky|ring)\.0(\d)\.([LR])$/))) return `${m[1]}_0${m[2]}_${side(m[3])}`;
  if ((m = name.match(/^DEF-thumb\.0(\d)\.([LR])$/))) return `thumb_0${m[1]}_${side(m[2])}`;
  if ((m = name.match(/^DEF-(shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe)\.([LR])$/))) {
    const map: Record<string, string> = { shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball' };
    return `${map[m[1]]}_${side(m[2])}`;
  }
  return name;
}

/** disposing an animation alone leaves its samplers holding the keyframe data, so prune can't drop it */
function disposeAnimation(a: Animation) {
  for (const ch of a.listChannels()) ch.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}

function keepClips(doc: Document) {
  const names = doc.getRoot().listAnimations().map((a) => a.getName());
  for (const want of KEEP) if (!names.includes(want)) console.warn(`  missing clip: ${want}`);
  for (const a of doc.getRoot().listAnimations()) if (!KEEP.includes(a.getName())) disposeAnimation(a);
}

const nodesByName = (doc: Document) => new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n] as const));

/**
 * Merge `src` into `doc` and hand back the nodes, skins and scenes that came with it, so the caller
 * can keep what it wants and dispose the rest.
 */
function mergeIn(doc: Document, src: Document) {
  const before = new Set(doc.getRoot().listNodes());
  const scenesBefore = new Set(doc.getRoot().listScenes());
  const skinsBefore = new Set(doc.getRoot().listSkins());
  mergeDocuments(doc, src);
  return {
    nodes: doc.getRoot().listNodes().filter((n) => !before.has(n)),
    scenes: doc.getRoot().listScenes().filter((s) => !scenesBefore.has(s)),
    skins: doc.getRoot().listSkins().filter((s) => !skinsBefore.has(s)),
  };
}

/** Add a rigged part (e.g. hair) so it is skinned to the body's own bones. */
function addPart(doc: Document, part: Document, label: string) {
  for (const a of part.getRoot().listAnimations()) disposeAnimation(a);
  const bones = nodesByName(doc);
  const bodyMeshNode = doc.getRoot().listNodes().find((n) => n.getSkin() && n.getMesh());
  const parent = bodyMeshNode?.getParentNode();
  const added = mergeIn(doc, part);
  for (const skin of added.skins) {
    for (const j of skin.listJoints()) {
      const mine = bones.get(j.getName());
      if (!mine) throw new Error(`${label}: bone ${j.getName()} is not in the body's skeleton`);
      skin.swap(j, mine);
    }
    const sk = skin.getSkeleton();
    if (sk && bones.get(sk.getName())) skin.setSkeleton(bones.get(sk.getName())!);
  }
  // keep the part's mesh nodes next to the body mesh; drop its copy of the skeleton
  for (const n of added.nodes) {
    if (n.getMesh()) {
      if (parent) parent.addChild(n);
      else doc.getRoot().listScenes()[0].addChild(n);
    }
  }
  for (const n of added.nodes) if (!n.getMesh()) n.dispose();
  for (const s of added.scenes) s.dispose();
}

/**
 * Body textures ship as 2-4K PNGs; 1K WebP is plenty for a figure a few metres from the camera.
 */
async function shrinkTextures(doc: Document) {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const label = tex.getURI() || tex.getName();
    try {
      const out = await sharp(Buffer.from(img)).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      tex.setImage(new Uint8Array(out)).setMimeType('image/webp').setURI(label.replace(/\.\w+$/, '') + '.webp');
    } catch (e) {
      console.warn(`  could not shrink ${label}, kept as is: ${(e as Error).message}`);
    }
  }
}

async function main() {
  const anims = await io.read(animsPath!);
  keepClips(anims);
  let doc: Document;

  if (!bodyPath) {
    doc = anims;
  } else {
    doc = await io.read(bodyPath);
    for (const a of doc.getRoot().listAnimations()) disposeAnimation(a);
    for (const p of parts) addPart(doc, await io.read(p), path.basename(p));
    await shrinkTextures(doc);

    const bones = nodesByName(doc);
    const useUnreal = bones.has('pelvis') && !bones.has('DEF-hips');
    const animBones = nodesByName(anims);
    // hips position is authored for the animation rig's height; scale it to the body's
    const srcHips = animBones.get('DEF-hips') ?? animBones.get('pelvis');
    const dstHips = bones.get('pelvis') ?? bones.get('DEF-hips');
    const len = (n?: Node) => (n ? Math.hypot(...n.getTranslation()) : 1);
    const hipScale = srcHips && dstHips ? len(dstHips) / len(srcHips) : 1;

    const added = mergeIn(doc, anims);
    let missing = 0;
    for (const a of doc.getRoot().listAnimations()) {
      for (const ch of a.listChannels()) {
        const t = ch.getTargetNode();
        const name = t ? (useUnreal ? toUnreal(t.getName()) : t.getName()) : '';
        const mine = bones.get(name);
        if (!mine) { ch.getSampler()?.dispose(); ch.dispose(); missing++; continue; }
        ch.setTargetNode(mine);
        if (ch.getTargetPath() === 'translation' && mine === dstHips && hipScale !== 1) {
          // samplers can be shared between clips once deduped; scale each output only once
          const out = ch.getSampler()!.getOutput()!;
          if (!out.getExtras().scaled) {
            const arr = out.getArray()!.slice();
            for (let i = 0; i < arr.length; i++) arr[i] *= hipScale;
            out.setArray(arr).setExtras({ scaled: true });
          }
        }
      }
    }
    if (missing) console.warn(`  ${missing} animation channels had no matching bone and were dropped`);
    for (const n of added.nodes) n.dispose();
    for (const s of added.scenes) s.dispose();
    doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
  }

  // a humanoid only needs bone rotations plus the hips' position; scale tracks and the other
  // bones' position tracks are constant and make up most of the file
  let dropped = 0;
  for (const a of doc.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) {
      const p = ch.getTargetPath(), name = ch.getTargetNode()?.getName() ?? '';
      if (p === 'scale' || (p === 'translation' && !/hips|pelvis/i.test(name))) { ch.getSampler()?.dispose(); ch.dispose(); dropped++; }
    }
  }
  console.log(`  dropped ${dropped} scale/translation tracks`);
  for (const acc of doc.getRoot().listAccessors()) acc.setExtras({});

  await doc.transform(resample(), dedup(), prune(), unpartition());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`Wrote ${outPath} (${kb} KB): ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
