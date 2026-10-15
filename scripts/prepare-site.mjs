import { execFileSync } from 'node:child_process';
import { copyFile, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('dist');
// The vendored USD runtime's commercial grant is unverified; BXI deploys URDF without it.
await rm(resolve(directory, 'usd-viewer'), { recursive: true, force: true });
await rm(resolve(directory, 'usd-iframe.html'), { force: true });
await copyFile('LICENSE', resolve(directory, 'LICENSE'));
await copyFile('NOTICE', resolve(directory, 'NOTICE'));

// Preserve installed production dependencies' license texts without adding a license-tool dependency.
const report = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'licenses', 'list', '--prod', '--json'], { encoding: 'utf8' }));
let notices = 'BXI URDF Viewer — third-party npm package licenses\n\n';
for (const packages of Object.values(report)) {
    for (const pkg of packages) {
        notices += `\n${'='.repeat(72)}\n${pkg.name}@${pkg.versions.join(', ')} — ${pkg.license}\n${pkg.homepage || ''}\n`;
        for (const name of (await readdir(pkg.paths[0])).sort()) {
            if (/^(licen[sc]e|copying|notice)(\.|$)/i.test(name)) {
                const path = resolve(pkg.paths[0], name);
                if ((await stat(path)).isFile()) notices += `\n${name}\n${await readFile(path, 'utf8')}\n`;
            }
        }
    }
}
await writeFile(resolve(directory, 'THIRD_PARTY_NOTICES.txt'), notices);
await writeFile(resolve(directory, 'esa.jsonc'), JSON.stringify({
    name: 'bxi_urdf_viewer', installCommand: '', buildCommand: '', assets: { directory: './' }
}, null, 2) + '\n');

const files = await readdir(directory, { recursive: true, withFileTypes: true });
let count = 0;
let total = 0;
let largest = 0;
for (const file of files) {
    if (!file.isFile()) continue;
    count++;
    const path = resolve(file.parentPath || file.path, file.name);
    const { size } = await stat(path);
    total += size;
    largest = Math.max(largest, size);
    if (size > 25_000_000) throw new Error(`ESA Pages 25 MB file limit exceeded: ${path}`);
}
if (count > 2000) throw new Error(`ESA Pages 2,000-file limit exceeded: ${count}`);
if (total > 1_024_000_000) throw new Error('ESA Pages package exceeds 1,024 MB before compression');
console.log(`ESA Pages check: ${count} files, ${(total / 1024 / 1024).toFixed(1)} MiB total, ${(largest / 1024 / 1024).toFixed(1)} MiB largest file`);
