---
name: double-exposure-to-fabrication
description: Turn two images (portrait + scene) into a double-exposure artwork and fabrication files — machine embroidery (DST/PES/EXP/JEF), print SVG, laser/CNC outline SVG — with sewing/appliqué guidance. Use when asked for double exposure art, image-to-embroidery, stitch files, or print/cut/CNC output from an image.
---
# Double exposure → embroidery / print / CNC / sew

Repo: https://github.com/SoMaCoSF/stitchlight (pipeline: `stitchlight/core.py`, browser demo: `demo/`).

## Steps
1. Get inputs. You need a portrait with the subject against a BRIGHT background, and a scene. If the subject is on a dark background, invert or matte it first; the mask comes from luminance (`threshold` 0.45–0.65).
2. Run `stitchlight.run(portrait, scene, outdir, colors=K, width_mm=W)`:
   - K = 4–8 for patches;
   - 6–12 for art pieces;
   - W = the size inside the hoop. Common hoops are 100×100, 130×180 and 200×300 mm.
3. Check `stitch_preview.png` and `summary.json`:
   - stitches at ~700 stitches per minute gives the sew time;
   - the colour count equals the number of thread changes.
4. Deliver the outputs:
   - **embroidery:** `design.dst` for any machine (give the user the palette hex list as the thread run sheet); `.pes` for Brother, `.jef` for Janome;
   - **print:** `print_regions.svg`, one filled path per colour, so one screen per colour;
   - **laser / vinyl / drag knife / plotter:** `cnc_paths.svg`, hairline strokes, one colour per operation;
   - **sewing at large scale:** cut the big regions as appliqué from `cnc_paths.svg`, edge them with satin, and keep fine detail as fill.
5. Report each claim as PROVEN / PLAUSIBLE / OWED: a file that re-reads in pyembroidery is PROVEN; how it sews is OWED until a real sew-out.

## Rules
- Do not use Ink/Stitch (GPL) or SingleFile (AGPL) code. pyembroidery is MIT and fine.
- Never redistribute third-party artwork used as a reference; describe it only.
- Defaults: rows 0.45 mm, stitches ≤ 4 mm, light colours before dark.
