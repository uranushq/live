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

import { UR9_TARGET_SIZE_M } from '~/aframe/components/fbx-model';
import { computePlaybackFrame } from '~/features/led-editor/utils';
import store from '~/store';

const { THREE } = AFrame;

const OFF_COLOR = 0x060606;

// Vertical offset (scene Z-up) that lifts the panel from the drone entity
// origin (sitting on the ground at the model base) to mid-height.
const PANEL_CENTER_Z = UR9_TARGET_SIZE_M.z / 2;
// Push the panel just past the -Y model surface so the tiles sit on the body
// instead of being buried (and occluded) inside the opaque mesh.
const PANEL_SURFACE_Y = -(UR9_TARGET_SIZE_M.y / 2 + 0.02);

const normalizeLeds = (value) => (value === 3 || value === 4 ? value : 4);

AFrame.registerComponent('drone-led-panel', {
  schema: {
    index: { type: 'int', default: 0 }, // matching LED-show drone index
    size: { type: 'number', default: 0.4875 }, // panel edge length, metres (0.39 × 1.25)
  },

  init() {
    this.group = new THREE.Group();
    this.el.setObject3D('ledpanel', this.group);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.materials = [];
    this.leds = 0;

    // Glue the panel to the drone's -Y face so its LEDs emit outward along -Y.
    // The grid is built in its own XY plane with normal +Z; reorient that plane
    // so its normal points along drone-local -Y and its "up" follows the
    // scene-up (+Z). Because this component is a child of the yaw-rotated drone
    // entity, the emission direction tracks the drone heading automatically.
    // Centre it on the face (x = 0, mid-height) and rest it on the surface
    // along -Y.
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0), // grid right (+X) -> drone +X (non-mirrored)
      new THREE.Vector3(0, 0, 1), // grid up    (+Y) -> drone +Z (scene up)
      new THREE.Vector3(0, -1, 0) // grid normal (+Z) -> drone -Y (outward)
    );
    this.group.quaternion.setFromRotationMatrix(basis);
    this.group.position.set(0, PANEL_SURFACE_Y, PANEL_CENTER_Z);

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
    // Fill ratio chosen so the absolute tile size is unchanged after the 1.25×
    // grid growth (0.6 × 0.39 / 0.4875), so only the gaps between pixels widen.
    const tile = cell * 0.48;
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
    // `threeDSync` off → hide the pixel panels entirely (default on; treat a
    // missing value as on for states persisted before the flag existed).
    const syncEnabled = led.threeDSync !== false;
    const hasShow = Array.isArray(boards) && boards.length > 0;
    this.group.visible = hasShow && syncEnabled;
    if (!hasShow || !syncEnabled) {
      return;
    }

    const leds = normalizeLeds(ledsPerDrone);
    if (this.leds !== leds) {
      this._build(leds);
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
