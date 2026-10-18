import { LatheGeometry, Shape, ShapeGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { listeningGarden } from '../../shared/ListeningGarden';

/** One uninterrupted swept profile, with a rounded seat, integrated back and capped ends. */
export function createListeningBench(): BufferGeometry {
  const section = new Shape();
  section.moveTo(-.41, .10); section.quadraticCurveTo(-.41, 0, -.31, 0);
  section.lineTo(.30, 0); section.quadraticCurveTo(.43, 0, .43, .13);
  section.lineTo(.43, .93); section.quadraticCurveTo(.43, 1.03, .33, 1.03);
  section.lineTo(.28, 1.03); section.quadraticCurveTo(.19, 1.03, .17, .92);
  section.lineTo(.11, .55); section.quadraticCurveTo(.10, .46, 0, .46);
  section.lineTo(-.30, .46); section.quadraticCurveTo(-.41, .46, -.41, .35); section.closePath();
  const profile = section.getPoints(10).map(p => p.setX(p.x + listeningGarden.radius));
  const body = new LatheGeometry(profile, 192, -listeningGarden.halfArc, listeningGarden.halfArc * 2);
  const caps = [-1, 1].map(side => {
    const geometry = new ShapeGeometry(new Shape(profile));
    if (side > 0) {
      const index = geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const second = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, second);
      }
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < normal.count; i++) normal.setZ(i, -1);
    }
    geometry.rotateY(side * listeningGarden.halfArc - Math.PI / 2); return geometry;
  });
  const merged = mergeGeometries([body, ...caps]); body.dispose(); caps.forEach(cap => cap.dispose());
  if (!merged) throw new Error('Continuous listening bench could not be created.');
  merged.computeBoundingBox(); merged.computeBoundingSphere(); return merged;
}
