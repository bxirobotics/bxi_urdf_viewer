import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelSnapshot, repository, request } from './sync-models.mjs';

export function modelResourcesChanged(previous, current) {
    return !previous || Object.keys(previous).length !== Object.keys(current).length ||
        Object.entries(current).some(([path, sha]) => previous[path] !== sha);
}

export async function checkModelUpdates() {
    const snapshot = await getModelSnapshot();
    const viewerRepository = process.env.GITHUB_REPOSITORY || 'bxirobotics/bxi_urdf_viewer';
    let catalog;
    try {
        const file = await request(`https://api.github.com/repos/${viewerRepository}/contents/dist/robots/catalog.json?ref=site`, true);
        catalog = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    } catch (error) {
        // A first deployment has no published catalog to compare against.
        if (error.status !== 404) throw error;
    }
    const changed = catalog?.source?.repository !== repository ||
        modelResourcesChanged(catalog.source.resourceTrees, snapshot.resourceTrees);
    if (process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\ncommit=${snapshot.commit}\n`);
    }
    console.log(changed
        ? `Model resources changed; build snapshot ${snapshot.commit}`
        : 'Model resources unchanged; skip download, build and publish');
    return { changed, commit: snapshot.commit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    checkModelUpdates().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
