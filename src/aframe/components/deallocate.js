/**
 * Helper A-Frame component that deallocates the WebGL context when the
 * scene is unmounted.
 *
 * Source: https://github.com/ngokevin/aframe-react/issues/110
 */

import AFrame from '@skybrush/aframe-components';

import { clearDroneModelTemplateCache } from '~/aframe/components/fbx-model';

const { Cache } = AFrame.THREE;

AFrame.registerComponent('deallocate', {
  remove() {
    Cache.clear();
    clearDroneModelTemplateCache();

    const renderer = this.el?.renderer;
    if (!renderer) {
      return;
    }

    // Dispose GPU resources and release the context so remounts (GoldenLayout
    // reparent / sceneId bump) do not exhaust the browser's WebGL context limit.
    try {
      renderer.dispose?.();
    } catch {
      // Ignore dispose races during React unmount.
    }

    try {
      renderer.forceContextLoss?.();
    } catch {
      // Ignore context-loss races during remount.
    }
  },
});
