import assert from 'node:assert/strict';
import test from 'node:test';
import { getResourceTrees, models } from '../../scripts/sync-models.mjs';
import { modelResourcesChanged } from '../../scripts/check-model-updates.mjs';

const modelTrees = () => models.map(({ id }, index) => ({ type: 'tree', path: `resources/${id}/urdf`, sha: `model-${index}` }));

test('unrelated upstream changes do not rebuild unchanged robot resources', () => {
    const published = getResourceTrees([...modelTrees(), { type: 'blob', path: 'src/controller.py', sha: 'old-code' }]);
    const latest = getResourceTrees([...modelTrees(), { type: 'blob', path: 'src/controller.py', sha: 'new-code' }]);
    assert.equal(modelResourcesChanged(published, latest), false);
});

test('a changed URDF directory hash in any of the four models requires a build', () => {
    const published = getResourceTrees(modelTrees());
    for (let index = 0; index < models.length; index++) {
        const latest = modelTrees();
        latest[index].sha = 'changed-mesh-or-urdf';
        assert.equal(modelResourcesChanged(published, getResourceTrees(latest)), true);
    }
});

test('a first deployment or changed set of tracked directories requires a build', () => {
    const latest = getResourceTrees(modelTrees());
    assert.equal(modelResourcesChanged(undefined, latest), true);
    assert.equal(modelResourcesChanged({ ...latest, obsolete: 'old-model' }, latest), true);
});

test('a missing model directory fails the check instead of accepting an incomplete snapshot', () => {
    assert.throws(() => getResourceTrees(modelTrees().slice(1)), /Missing model resource directory/);
});
