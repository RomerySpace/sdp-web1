import { BufferGeometry, Float32BufferAttribute, Path, Shape, ShapeGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { listeningGarden, lobbyGroundHeight } from '../../shared/ListeningGarden';

/** A real depression, not a surface placed above an intact flat floor. */
export function createLobbyGround(): BufferGeometry {
  const { x, z, outerRadius } = listeningGarden, segments = 128, rings = 64;
  const outline = new Shape();
  outline.moveTo(-1000, -1000); outline.lineTo(1000, -1000);
  outline.lineTo(1000, 1000); outline.lineTo(-1000, 1000); outline.closePath();
  const hole = new Path(); hole.absarc(x, -z, outerRadius, 0, Math.PI * 2, true); outline.holes.push(hole);
  const plain = new ShapeGeometry(outline, segments / 2); plain.rotateX(-Math.PI / 2);
  const positions = [x, lobbyGroundHeight(x, z), z], uvs = [x / 2000, z / 2000], indices: number[] = [];
  for (let ring = 1; ring <= rings; ring++) {
    const radius = outerRadius * ring / rings;
    for (let j = 0; j < segments; j++) {
      const angle = j / segments * Math.PI * 2, px = x + radius * Math.cos(angle), pz = z + radius * Math.sin(angle);
      positions.push(px, lobbyGroundHeight(px, pz), pz); uvs.push(px / 2000, pz / 2000);
      if (ring === 1) indices.push(0, 1 + (j + 1) % segments, 1 + j);
      else {
        const a = 1 + (ring - 2) * segments + j, b = a + segments;
        const c = 1 + (ring - 2) * segments + (j + 1) % segments, d = c + segments;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const hollow = new BufferGeometry(); hollow.setAttribute('position', new Float32BufferAttribute(positions, 3));
  hollow.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); hollow.setIndex(indices); hollow.computeVertexNormals();
  const combined = mergeGeometries([plain, hollow]); plain.dispose(); hollow.dispose();
  if (!combined) throw new Error('Lobby terrain geometry could not be merged.');
  combined.computeBoundingBox(); combined.computeBoundingSphere(); return combined;
}
