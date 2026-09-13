# Third-party notices

RedForge is distributed under the terms in [`LICENSE`](LICENSE). The following
third-party assets carry their own terms.

## LeePerrySmith head scan

`console/lib/bust-rings.generated.ts` contains horizontal contour rings sampled
from the **LeePerrySmith** head scan by **Lee Perry-Smith** (Infinite-Realities),
as distributed with [three.js](https://github.com/mrdoob/three.js) at
`examples/models/gltf/LeePerrySmith/LeePerrySmith.glb`.

- Licence: [Creative Commons Attribution 3.0 Unported (CC-BY 3.0)](https://creativecommons.org/licenses/by/3.0/)
- Attribution: Lee Perry-Smith / Infinite-Realities

The generated file is a derivative work: the mesh is sliced into quantised
horizontal contour loops by [`scripts/sample_bust_rings.mjs`](scripts/sample_bust_rings.mjs),
which retains only ring geometry (no vertices, textures, or UVs of the original
mesh are shipped). The source `.glb` is not redistributed in this repository.

To regenerate the asset:

```bash
curl -sLo /tmp/LeePerrySmith.glb \
  https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb
node scripts/sample_bust_rings.mjs /tmp/LeePerrySmith.glb console/lib/bust-rings.generated.ts
node scripts/preview_bust_rings.mjs   # writes a PNG of the sliced geometry
```
