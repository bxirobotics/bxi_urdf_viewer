/** BXI fork: built-in models use the existing FileHandler and joint controls. */
export async function fetchModelFiles(model, baseUrl, onProgress) {
    const files = new Map();
    let loaded = 0;
    for (let offset = 0; offset < model.files.length; offset += 6) {
        const results = await Promise.allSettled(model.files.slice(offset, offset + 6).map(async asset => {
            const response = await fetch(new URL(asset.url, baseUrl), { cache: 'force-cache', signal: AbortSignal.timeout(60000) });
            if (!response.ok) throw new Error(`${response.status}: ${asset.path}`);
            const payload = await response.arrayBuffer();
            const header = new Uint8Array(payload, 0, Math.min(3, payload.byteLength));
            // Some static hosts set Content-Encoding for .gz and the browser already decodes it.
            const gzip = asset.url.endsWith('.gz') && header[0] === 0x1f && header[1] === 0x8b && header[2] === 8;
            const bytes = gzip
                ? await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
                : payload;
            if (bytes.byteLength !== asset.sizeBytes) throw new Error(`Incomplete model resource: ${asset.path}`);
            const name = asset.path.split('/').pop();
            files.set(asset.path, new File([bytes], name));
            loaded += asset.downloadBytes;
            onProgress?.(loaded / model.downloadBytes);
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
    }
    if (!files.has(model.urdf)) throw new Error('Model URDF is missing from the catalog');
    return files;
}

export async function setupModelCatalog(app) {
    const select = document.getElementById('bxi-model-select');
    const status = document.getElementById('bxi-load-status');
    const progress = document.getElementById('bxi-load-progress');
    const retry = document.getElementById('bxi-retry');
    const localFolder = document.getElementById('bxi-local-folder');
    const localFiles = document.getElementById('bxi-local-files');
    const translate = key => window.i18n.t(key);
    let catalog;

    async function loadSelected() {
        const model = catalog.models.find(item => item.id === select.value);
        if (!model) return;
        select.disabled = true;
        localFolder.disabled = true;
        localFiles.disabled = true;
        retry.hidden = true;
        progress.hidden = false;
        progress.value = 0;
        status.classList.remove('error');
        status.textContent = translate('bxiLoading');
        try {
            const files = await fetchModelFiles(model, new URL('robots/', document.baseURI), value => {
                progress.value = value;
                status.textContent = `${translate('bxiLoading')} ${Math.round(value * 100)}%`;
            });
            // Keep the existing map object: the editor holds a reference to it.
            const previousFiles = new Map(app.fileHandler.fileMap);
            const previousModels = app.fileHandler.availableModels;
            const previousFile = app.fileHandler.currentModelFile;
            app.fileHandler.fileMap.clear();
            for (const [path, file] of files) app.fileHandler.fileMap.set(path, file);
            const file = files.get(model.urdf);
            file.bxiCatalogModel = true;
            const available = await app.fileHandler.findAllLoadableFiles([...files.values()]);
            app.fileHandler.availableModels = available;
            app.fileHandler.onFilesLoaded?.(available);
            const loaded = await app.fileHandler.loadFile(file);
            if (!loaded) {
                app.fileHandler.fileMap.clear();
                for (const [path, oldFile] of previousFiles) app.fileHandler.fileMap.set(path, oldFile);
                app.fileHandler.availableModels = previousModels;
                app.fileHandler.currentModelFile = previousFile;
                app.fileHandler.onFilesLoaded?.(previousModels);
                throw new Error(translate('loadFailed'));
            }
            status.textContent = `${model.label} · ${(model.downloadBytes / 1024 / 1024).toFixed(1)} MB`;
            const params = new URLSearchParams(location.search);
            params.set('model', model.id);
            history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
        } catch (error) {
            status.textContent = `${translate('loadFailed')}: ${error.message}`;
            status.classList.add('error');
            retry.hidden = false;
        } finally {
            select.disabled = false;
            localFolder.disabled = false;
            localFiles.disabled = false;
            progress.hidden = true;
        }
    }

    select.addEventListener('change', loadSelected);
    retry.addEventListener('click', () => catalog ? loadSelected() : initialize());
    localFolder.addEventListener('click', () => app.fileTreeView.triggerFileLoad(true));
    localFiles.addEventListener('click', () => app.fileTreeView.triggerFileLoad(false));
    const onFilesLoaded = app.fileHandler.onFilesLoaded;
    app.fileHandler.onFilesLoaded = files => {
        onFilesLoaded?.(files);
        if (!files.some(item => item.file.bxiCatalogModel)) {
            select.selectedIndex = -1;
            status.textContent = translate('bxiLocalModel');
            const params = new URLSearchParams(location.search);
            params.delete('model');
            history.replaceState(null, '', `${location.pathname}${params.size ? '?' + params : ''}${location.hash}`);
        }
    };
    async function initialize() {
        try {
            const response = await fetch(new URL('robots/catalog.json', document.baseURI), { cache: 'no-cache' });
            if (!response.ok) throw new Error(`${response.status}: catalog.json`);
            catalog = await response.json();
            select.replaceChildren(...catalog.models.map(model => new Option(model.label, model.id)));
            const requested = new URLSearchParams(location.search).get('model');
            select.value = catalog.models.some(model => model.id === requested) ? requested : catalog.defaultModel;
            await loadSelected();
        } catch (error) {
            select.disabled = false;
            status.textContent = `${translate('loadFailed')}: ${error.message}`;
            status.classList.add('error');
            retry.hidden = false;
        }
    }
    await initialize();
}
