import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mock, test } from 'node:test';
import { fetchModelFiles } from '../../src/controllers/ModelCatalog.js';

test('downloads only selected assets, decompresses without changing bytes and preserves URDF paths', async () => {
    const xml = Buffer.from('<robot name="elf3"/>');
    const stl = Buffer.from([0, 1, 254, 255]);
    const packed = gzipSync(stl);
    const model = {
        urdf: 'elf3/urdf/elf3.urdf', downloadBytes: xml.length + packed.length,
        files: [
            { path: 'elf3/urdf/elf3.urdf', url: 'assets/robot.urdf', sizeBytes: xml.length, downloadBytes: xml.length },
            { path: 'elf3/urdf/meshes/torso.STL', url: 'assets/torso.STL.gz', sizeBytes: stl.length, downloadBytes: packed.length }
        ]
    };
    const urls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
        urls.push(String(url));
        assert.equal(options.cache, 'force-cache');
        return new Response(String(url).endsWith('.gz') ? packed : xml);
    });
    try {
        let progress = 0;
        const files = await fetchModelFiles(model, 'https://example.com/viewer/robots/', value => { progress = value; });
        assert.equal(await files.get(model.urdf).text(), xml.toString());
        assert.deepEqual(Buffer.from(await files.get('elf3/urdf/meshes/torso.STL').arrayBuffer()), stl);
        assert.equal(files.get('elf3/urdf/meshes/torso.STL').name, 'torso.STL');
        assert.deepEqual(urls, ['https://example.com/viewer/robots/assets/robot.urdf', 'https://example.com/viewer/robots/assets/torso.STL.gz']);
        assert.equal(progress, 1);
    } finally { fetchMock.mock.restore(); }
});

test('reports HTTP and truncated resource errors instead of accepting partial downloads', async () => {
    const model = { urdf: 'robot.urdf', files: [{ path: 'robot.urdf', url: 'asset.urdf', sizeBytes: 20 }] };
    let fetchMock = mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
    try { await assert.rejects(fetchModelFiles(model, 'https://example.com/'), /404/); }
    finally { fetchMock.mock.restore(); }
    fetchMock = mock.method(globalThis, 'fetch', async () => new Response('short'));
    try { await assert.rejects(fetchModelFiles(model, 'https://example.com/'), /Incomplete/); }
    finally { fetchMock.mock.restore(); }
});

test('accepts gzip assets already decoded by HTTP Content-Encoding', async () => {
    const bytes = Buffer.from([0, 1, 254, 255]);
    const model = { urdf: 'robot.urdf', downloadBytes: 4, files: [{ path: 'robot.urdf', url: 'asset.STL.gz', sizeBytes: 4, downloadBytes: 4 }] };
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'Content-Encoding': 'gzip' } }));
    try {
        const files = await fetchModelFiles(model, 'https://example.com/');
        assert.deepEqual(Buffer.from(await files.get(model.urdf).arrayBuffer()), bytes);
    } finally { fetchMock.mock.restore(); }
});
