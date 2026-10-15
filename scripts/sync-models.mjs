import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const repository = 'bxirobotics/bxi_controller_ros2';
export const models = [
    { id: 'elf3_dof31', label: 'ELF3 · 31 DOF' },
    { id: 'elf3_dof31_hand', label: 'ELF3 · 31 DOF · Hand' },
    { id: 'elf3_dof29', label: 'ELF3 · 29 DOF' },
    { id: 'elf3_dof29_hand', label: 'ELF3 · 29 DOF · Hand' }
];

export function planModelFiles(model, xml, tree) {
    const prefix = `resources/${model.id}/urdf/`;
    const files = new Map(tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix))
        .map(entry => [entry.path.slice(prefix.length), entry]));
    const repairs = [];
    const content = xml.replace(/<!--[\s\S]*?-->/g, '');
    const references = [...content.matchAll(/<mesh\b[^>]*\bfilename\s*=\s*["']([^"']+)["']/g)];
    if (!content.includes('<robot') || references.length === 0) {
        throw new Error(`${model.id}: expected a URDF robot with mesh references`);
    }
    for (const [, reference] of references) {
        const path = posix.normalize(reference.replaceAll('\\', '/'));
        if (!path.startsWith('meshes/') || path.includes(':') || path.includes('../')) {
            throw new Error(`${model.id}: unsupported mesh path ${reference}`);
        }
        if (files.has(path)) continue;
        // shortcut: upstream 29-DOF models omit two fixed-head meshes; remove this repair when upstream includes them.
        const fallback = model.id.replace('dof29', 'dof31');
        const sourcePath = `resources/${fallback}/urdf/${path}`;
        const entry = /^(meshes\/head_[yz]_link\.STL)$/.test(path) && fallback !== model.id
            ? tree.find(candidate => candidate.type === 'blob' && candidate.path === sourcePath)
            : null;
        if (!entry) throw new Error(`${model.id}: missing mesh ${reference}`);
        files.set(path, entry);
        repairs.push({ path, sourcePath });
    }
    return { files: [...files].sort(([a], [b]) => a.localeCompare(b)), repairs };
}

export async function request(url, json = false) {
    const headers = { 'User-Agent': 'bxi-urdf-viewer' };
    if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Object.assign(new Error(`${response.status} ${response.statusText}: ${url}`), { status: response.status });
    return json ? response.json() : Buffer.from(await response.arrayBuffer());
}

export function getResourceTrees(tree) {
    return Object.fromEntries(models.map(({ id }) => {
        const path = `resources/${id}/urdf`;
        const entry = tree.find(item => item.path === path && item.type === 'tree');
        if (!entry) throw new Error(`Missing model resource directory: ${path}`);
        return [path, entry.sha];
    }));
}

export async function getModelSnapshot() {
    const ref = process.env.BXI_MODELS_REF || 'main';
    const { sha: commit } = await request(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`, true);
    const { tree, truncated } = await request(`https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`, true);
    if (truncated) throw new Error('GitHub returned an incomplete resource tree');
    return { commit, tree, resourceTrees: getResourceTrees(tree) };
}

export async function syncModels() {
    const { commit, tree, resourceTrees } = await getModelSnapshot();
    const rawBase = `https://raw.githubusercontent.com/${repository}/${commit}/`;
    const cache = new URL('../.cache/', import.meta.url);
    const output = new URL('../public/robots/', import.meta.url);
    await mkdir(cache, { recursive: true });
    const staging = await mkdtemp(fileURLToPath(new URL('robots-', cache)));
    const catalog = { source: { repository, commit, resourceTrees }, defaultModel: models[0].id, models: [] };
    const assets = new Map();
    try {
        for (const model of models) {
            const urdfPath = `resources/${model.id}/urdf/elf3.urdf`;
            const xml = (await request(rawBase + urdfPath)).toString('utf8');
            const { files, repairs } = planModelFiles(model, xml, tree);
            const record = { ...model, urdf: `${model.id}/urdf/elf3.urdf`, files: [], repairs, sizeBytes: 0, downloadBytes: 0 };
            for (let offset = 0; offset < files.length; offset += 6) {
                await Promise.all(files.slice(offset, offset + 6).map(async ([relativePath, entry]) => {
                    const path = `${model.id}/urdf/${relativePath}`;
                    const compressed = /\.stl$/i.test(relativePath);
                    const url = `assets/${entry.sha}${extname(relativePath)}${compressed ? '.gz' : ''}`;
                    if (!assets.has(url)) {
                        assets.set(url, (async () => {
                            const bytes = await request(rawBase + entry.path);
                            const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
                            if (hash !== entry.sha) throw new Error(`Resource integrity check failed: ${entry.path}`);
                            const packed = compressed ? gzipSync(bytes, { level: 9 }) : bytes;
                            const target = resolve(staging, url);
                            await mkdir(dirname(target), { recursive: true });
                            await writeFile(target, packed);
                            return { sizeBytes: bytes.length, downloadBytes: packed.length };
                        })());
                    }
                    const sizes = await assets.get(url);
                    record.sizeBytes += sizes.sizeBytes;
                    record.downloadBytes += sizes.downloadBytes;
                    record.files.push({ path, url, ...sizes });
                }));
            }
            record.files.sort((a, b) => a.path.localeCompare(b.path));
            catalog.models.push(record);
            console.log(`${model.label}: ${files.length} files, ${(record.downloadBytes / 1024 / 1024).toFixed(1)} MiB download, ${repairs.length} repaired references`);
        }
        await writeFile(resolve(staging, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
        // Only replace the last successful download after the entire snapshot passes validation.
        await rm(output, { recursive: true, force: true });
        await mkdir(new URL('../public/', import.meta.url), { recursive: true });
        await rename(staging, output);
        console.log(`Model snapshot: ${repository}@${commit}`);
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
    return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    syncModels().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
