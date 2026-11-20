// Which meshes / instances stand near given yard-frame (G) points of Nico's set piece? (front-door view clean-up)
(async () => {
  const T = game.THREE;
  const NH = game.nicoHouse;
  const pts = window.__probePts || [];
  const out = [];
  const m4 = new T.Matrix4();
  const v = new T.Vector3();
  for (const [gx, gz, label] of pts) {
    const w = NH.toWorld(new T.Vector3(gx, 0, gz));
    const hits = [];
    game.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4);
          v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
          const d = Math.hypot(v.x - w.x, v.z - w.z);
          if (d < 1.6) hits.push({ n: o.name || o.parent?.name, inst: i, d: +d.toFixed(2), y: +v.y.toFixed(1) });
        }
        return;
      }
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      v.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const d = Math.hypot(v.x - w.x, v.z - w.z);
      if (d < 1.6 && o.geometry.boundingSphere.radius < 20)
        hits.push({ n: o.name || o.parent?.name, pn: o.parent?.parent?.name, d: +d.toFixed(2) });
    });
    out.push({ label, g: [gx, gz], w: [+w.x.toFixed(1), +w.z.toFixed(1)], hits: hits.slice(0, 12) });
  }
  return JSON.stringify(out, null, 1);
})()
