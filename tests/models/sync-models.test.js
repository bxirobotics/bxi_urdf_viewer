import assert from 'node:assert/strict';
import test from 'node:test';
import { planModelFiles } from '../../scripts/sync-models.mjs';

const model = { id: 'elf3_dof29' };
const mesh = path => `<robot name="test"><link name="head"><visual><geometry><mesh filename="${path}"/></geometry></visual></link></robot>`;
const entry = path => ({ type: 'blob', path, sha: 'test' });

test('resolves relative STL references and ignores commented meshes', () => {
    const tree = [entry('resources/elf3_dof29/urdf/meshes/torso.STL')];
    const plan = planModelFiles(model, mesh('./meshes/torso.STL') + '<!-- <mesh filename="missing.STL"/> -->', tree);
    assert.equal(plan.files.length, 1);
    assert.deepEqual(plan.repairs, []);
});

test('borrows only the known missing head meshes from the matching 31-DOF variant', () => {
    const sourcePath = 'resources/elf3_dof31_hand/urdf/meshes/head_y_link.STL';
    const plan = planModelFiles({ id: 'elf3_dof29_hand' }, mesh('./meshes/head_y_link.STL'), [entry(sourcePath)]);
    assert.deepEqual(plan.repairs, [{ path: 'meshes/head_y_link.STL', sourcePath }]);
    assert.equal(plan.files[0][1].path, sourcePath);
});

test('missing or unsafe meshes fail the build instead of publishing incomplete models', () => {
    assert.throws(() => planModelFiles(model, mesh('./meshes/missing.STL'), []), /missing mesh/);
    assert.throws(() => planModelFiles(model, mesh('../../secret.STL'), []), /unsupported mesh path/);
    assert.throws(() => planModelFiles(model, mesh('https://example.com/mesh.STL'), []), /unsupported mesh path/);
    assert.throws(() => planModelFiles(model, '<html>Not a robot</html>', []), /expected a URDF/);
});
