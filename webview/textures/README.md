# Dokur textile materials

Generated with the **built-in Imagegen tool** on 2026-11-03. These are generated photographic-style materials, not photographs licensed from a stock library. Full prompts and original locations for the new set are preserved in [source/material-prompts.json](source/material-prompts.json). The original generated PNGs are copied into [source/](source/) without altering them.

| Resource | Fabric                        | Cord                       |
| -------- | ----------------------------- | -------------------------- |
| Services | Washed blue denim             | Blue twisted cotton        |
| Networks | Sage cotton canvas            | Sage braided cotton        |
| Volumes  | Sand / golden jute burlap     | Natural jute twine         |
| Secrets  | Dusty burgundy cotton velvet  | Burgundy silk-cotton braid |
| Configs  | Ivory washed linen            | Natural twisted cotton     |
| Models   | Heather lilac wool felt       | Fuzzy lilac wool yarn      |
| Jobs     | Faded terracotta cotton twill | Terracotta waxed cotton    |

Each fabric is a photographic cutout with real alpha, irregular raw edges, shallow tears, loose fibers, and worn corners. The center stays calm and opaque for text. At runtime, nine-slice rendering preserves the edges as cards resize; alpha-derived contours control pointer hit areas and connection ports. Selection and keyboard-focus shadows follow the actual alpha silhouette. Connection ropes and row seams use the matching material. Job connections use job cord; other connections use their target resource's cord.

The extension bundles the 14 optimized `fabric-*.webp` and `rope-*.webp` files and loads them locally without remote requests. `npm run materials:prepare` uses Chromium to resize the source PNGs (maximum 900 px) and encode WebP with alpha; it does not modify the originals. Working source PNGs are excluded from the VSIX.

## Earlier neutral materials

- [Washed linen](washed-linen.png): source material for calm fabric panels.
- [Cotton cord](cotton-rope.png): a transparent source strip mapped along connection curves at runtime, also used for quiet row seams.

These older originals are kept for provenance. The cotton cord is reused for the config profile; the neutral linen is superseded by the new frayed cutouts. Their full prompts follow.

## Linen prompt

Use case: photorealistic-natural. Asset type: a seamless material texture for fabric panels in a desktop developer tool, NOT a UI mockup. Create one photorealistic top-down macro photograph of real softly washed linen-cotton fabric in a subdued neutral warm gray. Fill the entire square frame with the same flat cloth. The yarns have gently irregular thickness, tiny loose natural fibers, subtle real interlacing, and a soft matte surface. Diffuse flat overcast lighting, restrained very low contrast, even illumination across all edges. No folds, no wrinkles casting shadows, no visible edges, no stitches, no props, no design, no text, no watermark. This is a calm textile albedo texture that can repeat seamlessly on all four edges. Avoid a perfect geometric grid, moire, sharp repetitive artificial lines, digitally drawn weave, embossed or plastic texture, CGI render, oversharpening, bright specular highlights, strong high-frequency contrast. Natural material authenticity is the priority. The weave should be soft and tactile, not synthetic.

## Cotton cord prompt

Use case: photorealistic-natural. Asset type: a photographic cotton cord texture strip for curved connection lines in a desktop tool, NOT a mockup. A single straight, horizontal, continuous strand of real soft three-ply twisted cotton cord, unbleached natural flax/taupe ivory, photographed directly from above in diffuse soft studio light. Macro photography, authentic irregular tiny cotton fibers, soft fuzzy silhouette, believable rounded volume and subdued self-shadowing between the plies. The cord runs fully from the LEFT image edge to the RIGHT image edge, perfectly straight, with both ends cropped by the image edges so it can repeat continuously. The cord fills approximately 75 percent of the image HEIGHT, with only thin transparent margins above and below. Very wide landscape composition, about 3:1. Transparent background with real alpha, no ground plane, no cast shadow on any background, no other objects. No knotted ends, no loops, no braid border, no text or watermark. No illustration, vector, CGI, digital striping, regular ribbed tubing, glowing cable, metallic/plastic highlights, harsh ridges, high-contrast barber-pole pattern. It must look like a real piece of soft natural cotton string, with delicate photographic fibers. Even low-contrast lighting and neutral natural material color.
