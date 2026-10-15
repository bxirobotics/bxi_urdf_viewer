import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../../src/renderer/SceneManager.js';

test('default framing looks straight at the robot from its forward X axis', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    const target = new THREE.Vector3();
    const manager = {
        camera,
        currentModel: { joints: new Map([['joint', {}]]) },
        controls: { target, update: () => camera.lookAt(target) },
        redraw() {}
    };
    const bounds = new THREE.Box3(new THREE.Vector3(-0.2, -1, -0.5), new THREE.Vector3(0.2, 1, 0.5));
    const center = bounds.getCenter(new THREE.Vector3());
    SceneManager.prototype.fitCameraToModel.call(manager, bounds, center, bounds.getSize(new THREE.Vector3()));
    const view = camera.position.clone().sub(target).normalize();
    assert.ok(view.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-8);

    manager.currentModel.joints.clear();
    SceneManager.prototype.fitCameraToModel.call(manager, bounds, center, bounds.getSize(new THREE.Vector3()));
    const meshView = camera.position.clone().sub(target).normalize();
    assert.ok(Math.abs(meshView.y - 0.5) < 1e-8);
    assert.ok(Math.abs(meshView.x - meshView.z) < 1e-8);
});
