#!/bin/bash
# Rebuilds the web-ready models in public/models from the raw Meshy outputs (meshopt geometry, webp textures).
# <raw-dir> holds models2/ (image-to-3d pieces and props), props/ (scenery), rig/ (Meshy rigs) and anim/ (library
# clips and retargeted ride motions).
# The ponies are rigged and animated here (rig_horse.py), the siege towers get rolling wheels (split_wheels.py).
# optimize flattens and joins nodes by default, which would merge the towers' wheels back into the body.
# usage: art/export_models.sh <raw-dir>
RAW="$1"
[ -d "$RAW" ] || { echo "usage: $0 <raw-dir>"; exit 1; }
ART="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$ART")"
OUT="$ROOT/public/models"
BLENDER="${BLENDER:-$HOME/Applications/Blender.app/Contents/MacOS/Blender}"
TMP="$(mktemp -d)"
mkdir -p "$OUT"
export_one() {
  (cd "$ROOT" && pnpm exec gltf-transform optimize "$1" "$OUT/$2.glb" --compress meshopt --texture-compress webp --texture-size "$3" --simplify false "${@:4}") \
    && echo "ok $2 ($3)" || echo "FAIL $2"
}
# the soldiers' shields and swords are made rigid (one hand bone each) so they don't bend as the soldier moves
# the pale soldier's upper arm swings out through its rigid shield when running; 0.035 pushes the shield clear of it
# (the dark soldier's shield already sits clear of its arm)
"$BLENDER" -b --python "$ART/rigid_props.py" -- "$RAW/rig/light_pawn/rigged_character.glb" "$TMP/pawn_light.glb" LeftHand:disc,0.16,0.16,0.2,0.03,0.01,1.05,0.035 RightHand:0.3,0.2,0.35,0.0 > /dev/null 2>&1 && export_one "$TMP/pawn_light.glb" pawn_light 512
"$BLENDER" -b --python "$ART/rigid_props.py" -- "$RAW/rig/dark_pawn/rigged_character.glb" "$TMP/pawn_dark.glb" LeftHand:disc,0.16,0.16,0.2,0.03,0.025,1.08 RightHand:0.3,0.2,0.35,0.0 > /dev/null 2>&1 && export_one "$TMP/pawn_dark.glb" pawn_dark 512
for team in light dark; do
  for p in bishop queen king rider; do export_one "$RAW/rig/${team}_$p/rigged_character.glb" "${p}_$team" 512; done
  "$BLENDER" -b --python "$ART/rig_horse.py" -- "$RAW/models2/${team}_horse/model.glb" "$TMP/horse_$team.glb" > /dev/null 2>&1 && export_one "$TMP/horse_$team.glb" "horse_$team" 512
  "$BLENDER" -b --python "$ART/split_wheels.py" -- "$RAW/models2/${team}_tower/model.glb" "$TMP/tower_$team.glb" -90 > /dev/null 2>&1 && export_one "$TMP/tower_$team.glb" "tower_$team" 512 --flatten false --join false
done
for p in staff scepter sword; do export_one "$RAW/models2/prop_$p/model.glb" "prop_$p" 256; done
# scenery around the board
for p in tree tent_light tent_dark; do export_one "$RAW/props/m_$p/model.glb" "$p" 512; done
for p in mushrooms rock; do export_one "$RAW/props/m_$p/model.glb" "$p" 256; done
A="$RAW/anim/setA/animation_glb.glb"
B="$RAW/anim/setB/animation_glb.glb"
C="$RAW/anim/setC/animation_glb.glb"
D="$RAW/anim/setD/animation_glb.glb"
python3 "$ART/build_anims.py" "$TMP/anims.glb" \
  idle=$A:0 walk=$A:1 slash=$A:2 attack=$A:3 spell=$A:4 charge=$A:5 hammer=$A:6 flyup=$A:7 knockdown=$A:8 dieback=$A:9 \
  run=$RAW/rig/light_pawn/running_armature_glb.glb cheer=$B:0 bow=$B:1 alert=$B:2 kneel=$B:3 hit=$B:4 dance=$B:5 judgment=$B:6 jump=$B:7 idle2=$B:8 look=$B:9 \
  proud=$C:0 idle_queen=$C:1 idle_calm=$C:2 primp=$C:3 idle_still=$D:0 \
  && export_one "$TMP/anims.glb" anims 256
python3 "$ART/build_anims.py" "$TMP/ride.glb" $(for c in idle gallop slash; do echo "ride_$c=$RAW/anim/ride_${c}_rt/animation_glb.glb"; done) \
  && export_one "$TMP/ride.glb" ride 256
rm -rf "$TMP"
