import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverModels, getResourceTrees } from '../../scripts/sync-models.mjs';
import { checkModelUpdates, modelResourcesChanged } from '../../scripts/check-model-updates.mjs';

const resourceTree = sha => ({ type: 'tree', path: 'resources', sha });
const urdf = path => ({ type: 'blob', path });

test('upstream code changes do not rebuild unchanged resources', () => {
    const published = getResourceTrees([resourceTree('same'), { type: 'blob', path: 'src/controller.py', sha: 'old' }]);
    const latest = getResourceTrees([resourceTree('same'), { type: 'blob', path: 'src/controller.py', sha: 'new' }]);
    assert.equal(modelResourcesChanged(published, latest), false);
});

test('any resources change requires a build, including added or removed models', () => {
    assert.equal(modelResourcesChanged(getResourceTrees([resourceTree('old')]), getResourceTrees([resourceTree('new')])), true);
});

test('first deployment and migration from the four-directory snapshot require a build', () => {
    const latest = getResourceTrees([resourceTree('latest')]);
    assert.equal(modelResourcesChanged(undefined, latest), true);
    assert.equal(modelResourcesChanged({ 'resources/elf3_dof31/urdf': 'old' }, latest), true);
    assert.throws(() => getResourceTrees([]), /Missing model resource directory/);
});

test('discovers every URDF including new models, source URDFs and root files', () => {
    const models = discoverModels([
        urdf('resources/elf3_dof31_head1/urdf/elf3_dof31_head1.urdf'),
        urdf('resources/elf3_dof29/urdf/elf3.urdf'),
        urdf('resources/gripper/source/robot.urdf'),
        urdf('resources/standalone.URDF'),
        urdf('outside/ignored.urdf'),
        urdf('resources/gripper/README.md')
    ]);
    assert.equal(models.length, 4);
    assert.ok(models.some(model => model.id === 'elf3_dof31_head1'));
    assert.ok(models.some(model => model.id === 'elf3_dof29'));
    assert.ok(models.some(model => model.urdf === 'source/robot.urdf'));
    assert.ok(models.some(model => model.id === 'standalone' && model.directory === ''));
    assert.throws(() => discoverModels([]), /No URDF/);
});

test('daily checks use the published resource hash, not the upstream commit', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    let previous = { repository: 'bxirobotics/bxi_controller_ros2', resourceTrees: { resources: 'same' } };
    let status = 200;
    globalThis.fetch = async url => {
        if (url.includes('/commits/main')) return Response.json({ sha: 'new-unrelated-commit' });
        if (url.includes('/git/trees/')) return Response.json({ tree: [resourceTree('same'), urdf('resources/model/urdf/model.urdf')], truncated: false });
        if (url.includes('/contents/dist/robots/catalog.json?ref=site')) {
            if (status !== 200) return new Response('', { status });
            return Response.json({ content: Buffer.from(JSON.stringify({ source: previous })).toString('base64') });
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    assert.equal((await checkModelUpdates()).changed, false);
    previous.resourceTrees.resources = 'old';
    assert.equal((await checkModelUpdates()).changed, true);
    status = 404;
    assert.equal((await checkModelUpdates()).changed, true);
    status = 403;
    await assert.rejects(checkModelUpdates(), /403/);
});
