import { connect } from 'react-redux';

import { DrawingToolbar as DrawingToolbarPresentation } from '~/components/map';
import { Tool } from '~/components/map/tools';
import { removeSelectedFeatures } from '~/features/map-features/actions';
import { getSelectedFeatureIds } from '~/features/map-features/selectors';
import { getSelectedTool, setSelectedTool } from '~/features/map/tools';
import { removeSelectedMissionItems } from '~/features/mission/actions';
import { getSelectedMissionItemIds } from '~/features/mission/selectors';
import type { AppDispatch, RootState } from '~/store/reducers';
import { hasFeature } from '~/utils/configuration';

/**
 * Drawing toolbar on the map.
 */
const DrawingToolbar = connect(
  // mapStateToProps
  (state: RootState) => {
    const selectedFeatureIds = getSelectedFeatureIds(state);
    const selectedMissionItemIds = getSelectedMissionItemIds(state);

    return {
      hasRemovableShapes:
        selectedFeatureIds.length > 0 || selectedMissionItemIds.length > 0,
      selectedTool: getSelectedTool(state),
      showRemoveButton: hasFeature('mapFeatures') || hasFeature('missionEditor'),
    };
  },
  // mapDispatchToProps
  (dispatch: AppDispatch) => ({
    onRemoveSelection: () => {
      dispatch(removeSelectedFeatures());
      dispatch(removeSelectedMissionItems());
    },
    onToolSelected: (tool: Tool) => dispatch(setSelectedTool(tool)),
  })
)(DrawingToolbarPresentation);

export default DrawingToolbar;
