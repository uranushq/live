/**
 * A-Frame component that attaches a small k×k LED panel to a single drone in
 * the 3D view and animates its colours in real time from the LED show in the
 * Redux store.
 *
 * One instance lives as a child of each drone entity, so the panel follows the
 * drone as it flies its path. The panel is billboarded to face the camera and
 * shows the colours of the LED-show drone with the matching index.
 *
 * Uses A-Frame's bundled THREE (a separately-imported `three` would be a
 * different module instance and fail A-Frame's `instanceof` checks).
 */

import AFrame from '@skybrush/aframe-components';

import { computePlaybackFrame } from '~/features/led-editor/utils';
import store from '~/store';

const { THREE } = AFrame;

const OFF_COLOR = 0x060606;

const normalizeLeds = (value) => (value === 3 || value === 4 ? value : 4);

AFrame.registerComponent('drone-led-panel', {
  schema: {
    index: { type: 'int', default: 0 }, // matching LED-show drone index
    size: { type: 'number', default: 1.2 }, // panel edge length, metres
  },

  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('ledpanel', this.group);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.materials = [];
    this.leds = 0;
    this._camPos = new THREE.Vector3();
    this._build(normalizeLeds(store.getState().ledEditor?.ledsPerDrone));
  },

  remove() {
    this._disposeMeshes();
    this.geometry.dispose();
    if (this.el.getObject3D('ledpanel')) {
      this.el.removeObject3D('ledpanel');
    }
  },

  _disposeMeshes() {
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials = [];
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
  },

  _build(leds) {
    this._disposeMeshes();
    this.leds = leds;
    const { size } = this.data;
    const cell = size / leds;
    const tile = cell * 0.82;
    for (let local = 0; local < leds * leds; local++) {
      const lx = local % leds;
      const ly = Math.floor(local / leds);
      const material = new THREE.MeshBasicMaterial({
        color: OFF_COLOR,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.scale.set(tile, tile, 1);
      // Centre the grid; row 0 at the top.
      mesh.position.set(
        (lx + 0.5) * cell - size / 2,
        size / 2 - (ly + 0.5) * cell,
        0
      );
      this.group.add(mesh);
      this.materials.push(material);
    }
  },

  tick() {
    const led = store.getState().ledEditor;
    if (!led) {
      return;
    }
    const { boards, droneCount, ledsPerDrone, playheadSec } = led;
    const hasShow = Array.isArray(boards) && boards.length > 0;
    this.group.visible = hasShow;
    if (!hasShow) {
      return;
    }

    const leds = normalizeLeds(ledsPerDrone);
    if (this.leds !== leds) {
      this._build(leds);
    }

    // Billboard the panel towards the camera so the colours are always visible.
    const camera = this.el.sceneEl && this.el.sceneEl.camera;
    if (camera) {
      camera.getWorldPosition(this._camPos);
      this.group.lookAt(this._camPos);
    }

    const frame = computePlaybackFrame(boards, droneCount, ledsPerDrone, playheadSec);
    const pixels = frame.drones ? frame.drones[this.data.index] : undefined;
    for (let i = 0; i < this.materials.length; i++) {
      const pixel = pixels ? pixels[i] : undefined;
      if (pixel && (pixel[0] || pixel[1] || pixel[2])) {
        this.materials[i].color.setRGB(
          pixel[0] / 255,
          pixel[1] / 255,
          pixel[2] / 255
        );
      } else {
        this.materials[i].color.setHex(OFF_COLOR);
      }
    }
  },
});
