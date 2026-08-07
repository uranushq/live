import SmartToy from '@mui/icons-material/SmartToy';
import Popover from '@mui/material/Popover';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { colorForStatus, Status } from '@skybrush/app-theme-mui';
import { GenericHeaderButton, SidebarBadge } from '@skybrush/mui-components';

import { isConnected } from '~/features/servers/selectors';
import type { RootState } from '~/store/reducers';
import {
  getVirtualUavsStatus,
  type VirtualUavsStatus,
} from '~/utils/virtualUavs';

import VirtualUavsControl from './VirtualUavsControl';

const BADGE_OFFSET = [24, 8];

const buttonStyle = {
  justifyContent: 'space-between',
  textAlign: 'right' as const,
  width: 84,
};

type VirtualUavsHeaderButtonProps = Readonly<{
  isConnected: boolean;
}>;

const emptyStatus: VirtualUavsStatus = {
  enabled: false,
  count: 0,
  uavIds: [],
};

/**
 * Header button for the virtual UAV fleet REST API.
 * Opens a persistent popover on click (not hover).
 *
 * Always shown in the header; availability is determined by the REST endpoint
 * rather than the optional Flockwave `virtual_uavs` feature flag.
 */
const VirtualUavsHeaderButton = ({
  isConnected,
}: VirtualUavsHeaderButtonProps): JSX.Element => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<VirtualUavsStatus>(emptyStatus);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const refresh = useCallback(async () => {
    if (!isConnected) {
      setStatus(emptyStatus);
      return;
    }

    try {
      setStatus(await getVirtualUavsStatus());
    } catch {
      // Keep the last known status; the popover control surfaces errors.
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) {
      setStatus(emptyStatus);
      return;
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isConnected, refresh]);

  const badgeStatus = !isConnected
    ? null
    : status.enabled
      ? Status.SUCCESS
      : Status.OFF;

  return (
    <>
      {/* onClick/style are accepted at runtime but omitted from GenericHeaderButton typings */}
      <GenericHeaderButton
        disabled={!isConnected}
        label={isConnected ? String(status.count) : '—'}
        secondaryLabel={
          isConnected
            ? status.enabled
              ? t('virtualUavsControl.enabled')
              : t('virtualUavsControl.disabled')
            : undefined
        }
        {...({
          'aria-controls': open ? 'virtual-uavs-popover' : undefined,
          'aria-expanded': open ? 'true' : undefined,
          'aria-haspopup': 'true',
          onClick: (event: React.MouseEvent<HTMLElement>) => {
            setAnchorEl(event.currentTarget);
          },
          style: buttonStyle,
          tooltip: t('virtualUavsControl.title'),
        } as object)}
      >
        <SmartToy />
        <SidebarBadge
          anchor='topLeft'
          color={badgeStatus ? colorForStatus(badgeStatus) : undefined}
          offset={BADGE_OFFSET}
          visible={Boolean(badgeStatus && badgeStatus !== Status.OFF)}
        />
      </GenericHeaderButton>
      <Popover
        id='virtual-uavs-popover'
        open={open}
        anchorEl={anchorEl}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        onClose={() => {
          setAnchorEl(null);
        }}
      >
        <VirtualUavsControl
          active={open}
          initialStatus={status}
          onStatusChange={setStatus}
        />
      </Popover>
    </>
  );
};

export default connect((state: RootState) => ({
  isConnected: isConnected(state),
}))(VirtualUavsHeaderButton);
