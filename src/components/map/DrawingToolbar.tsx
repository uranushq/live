import CropSquare from '@mui/icons-material/CropSquare';
import Delete from '@mui/icons-material/Delete';
import FiberManualRecord from '@mui/icons-material/FiberManualRecord';
import PanoramaFishEye from '@mui/icons-material/PanoramaFishEye';
import Place from '@mui/icons-material/Place';
import SelectAll from '@mui/icons-material/SelectAll';
import ShowChart from '@mui/icons-material/ShowChart';
import StarBorder from '@mui/icons-material/StarBorder';
import ZoomIn from '@mui/icons-material/ZoomIn';
import Box from '@mui/material/Box';
import type { SvgIconProps } from '@mui/material';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import type { TFunction } from 'i18next';
import React from 'react';
import { withTranslation } from 'react-i18next';

import { Tool } from '~/components/map/tools';
import { type PreparedI18nKey, tt } from '~/i18n';
import ContentCut from '~/icons/ContentCut';
import EditFeature from '~/icons/EditFeature';
import { mapOverlayShell } from '~/views/map/mapPanelStyles';

type ToolConfig = {
  tool: Tool;
  label: PreparedI18nKey;
  icon: React.ComponentType<SvgIconProps>;
};

type DrawingToolId =
  | 'add-marker'
  | 'add-waypoint'
  | 'cut-hole'
  | 'draw-circle'
  | 'draw-path'
  | 'draw-polygon'
  | 'draw-rectangle'
  | 'edit-feature'
  | 'select'
  | 'zoom';

const drawingToolRegistry: Record<DrawingToolId, ToolConfig> = {
  'add-marker': {
    tool: Tool.DRAW_POINT,
    label: tt('DrawingToolbar.addMarker'),
    icon: FiberManualRecord,
  },
  'add-waypoint': {
    tool: Tool.ADD_WAYPOINT,
    label: tt('DrawingToolbar.addWaypoint'),
    icon: Place,
  },
  'cut-hole': {
    tool: Tool.CUT_HOLE,
    label: tt('DrawingToolbar.cutHole'),
    icon: ContentCut,
  },
  'draw-circle': {
    tool: Tool.DRAW_CIRCLE,
    label: tt('DrawingToolbar.drawCircle'),
    icon: PanoramaFishEye,
  },
  'draw-path': {
    tool: Tool.DRAW_PATH,
    label: tt('DrawingToolbar.drawPath'),
    icon: ShowChart,
  },
  'draw-polygon': {
    tool: Tool.DRAW_POLYGON,
    label: tt('DrawingToolbar.drawPolygon'),
    icon: StarBorder,
  },
  'draw-rectangle': {
    tool: Tool.DRAW_RECTANGLE,
    label: tt('DrawingToolbar.drawRectangle'),
    icon: CropSquare,
  },
  'edit-feature': {
    tool: Tool.EDIT_FEATURE,
    label: tt('DrawingToolbar.editFeature'),
    icon: EditFeature,
  },
  select: {
    tool: Tool.SELECT,
    label: tt('general.action.select'),
    icon: SelectAll,
  },
  zoom: {
    tool: Tool.ZOOM,
    label: tt('general.geometry.zoom'),
    icon: ZoomIn,
  },
};

type DrawingToolIdGroup = DrawingToolId[];

type DrawingToolbarProps = {
  dense?: boolean;
  drawingTools: DrawingToolIdGroup[];
  hasRemovableShapes?: boolean;
  onRemoveSelection?: () => void;
  onToolSelected: (tool: Tool) => void;
  selectedTool: Tool;
  showRemoveButton?: boolean;
  t: TFunction;
};

/* Mirrors MapRightSidebar's button style */
const mkBtnSx = (selected: boolean, danger = false) =>
  ({
    color: selected ? '#6eb6ff' : danger ? '#f06060' : 'rgba(255,255,255,0.88)',
    height: 34,
    width: 34,
    borderRadius: 1.5,
    backgroundColor: selected ? 'rgba(94,162,255,0.18)' : 'transparent',
    transition: 'color 0.15s, background-color 0.15s',
    '& .MuiSvgIcon-root': {
      fontSize: '1.1rem',
      color: 'inherit',
    },
    '&:hover': {
      backgroundColor: selected
        ? 'rgba(94,162,255,0.28)'
        : danger
          ? 'rgba(240,96,96,0.12)'
          : 'rgba(255,255,255,0.08)',
    },
    '&.Mui-disabled': {
      color: 'rgba(255,255,255,0.20)',
    },
  }) as const;

const panelSx = {
  ...mapOverlayShell,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  left: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  pointerEvents: 'auto' as const,
  py: 0.75,
  px: 0.25,
  '& .MuiDivider-root': {
    borderColor: 'rgba(255,255,255,0.12)',
    width: '70%',
    my: 0.4,
  },
} as const;

const DrawingToolbar = ({
  drawingTools,
  hasRemovableShapes = false,
  onRemoveSelection,
  onToolSelected,
  selectedTool,
  showRemoveButton = false,
  t,
}: DrawingToolbarProps) => (
  <Box sx={panelSx}>
    {drawingTools
      .flatMap((group) => [
        <Divider key={`drawing-toolbar-group:${group.join(',')}`} flexItem />,
        ...group.map((toolId) => {
          const { tool, label, icon: Icon } = drawingToolRegistry[toolId];
          const isSelected = selectedTool === tool;
          return (
            <IconButton
              key={toolId}
              size='small'
              title={label(t)}
              onClick={() => onToolSelected(tool)}
              sx={mkBtnSx(isSelected)}
            >
              <Icon fontSize='small' />
            </IconButton>
          );
        }),
      ])
      .slice(1)}
    {showRemoveButton && onRemoveSelection ? (
      <>
        <Divider flexItem />
        <IconButton
          size='small'
          disabled={!hasRemovableShapes}
          title={tt('DrawingToolbar.removeSelection')(t)}
          onClick={onRemoveSelection}
          sx={mkBtnSx(false, true)}
        >
          <Delete fontSize='small' />
        </IconButton>
      </>
    ) : null}
  </Box>
);

/**
 * Drawing toolbar on the map.
 */
const TranslatedDrawingToolbar = withTranslation()(DrawingToolbar);

export default TranslatedDrawingToolbar;
