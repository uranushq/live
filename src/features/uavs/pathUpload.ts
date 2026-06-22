import createColor from 'color';
import type { CSSProperties } from 'react';

import { Status } from '~/components/semantics';
import { JOB_TYPE as SHOW_UPLOAD_JOB_TYPE } from '~/features/show/constants';
import UAVErrorCode from '~/flockwave/UAVErrorCode';

import {
  DATALINK_COLOR_EXCELLENT as PATH_UPLOADED_COLOR,
  DATALINK_COLOR_POOR as PATH_NOT_UPLOADED_COLOR,
} from './datalink';
import type { StoredUAV } from './types';

export type PathUploadContext = Readonly<{
  /** Path-planner 등으로 드론에 직접 업로드된 경우 */
  externalShowUploaded?: boolean;
  /** 현재(또는 직전) 업로드 job 유형. Path OK는 show 업로드일 때만 반영 */
  uploadJobType?: string;
}>;

/**
 * Whether the show path is considered uploaded for this UAV.
 *
 * OK only when this session's show upload succeeded for the UAV (or an
 * external upload was flagged). Telemetry alone does not imply upload.
 * Other upload types (geofence, parameters, etc.) must not affect this.
 */
export function isPathUploadedForUav(
  uav: StoredUAV | undefined,
  uploadStatus?: Status,
  { externalShowUploaded = false, uploadJobType }: PathUploadContext = {}
): boolean {
  if (!uav) {
    return false;
  }

  if (externalShowUploaded) {
    return true;
  }

  const isShowUploadJob = uploadJobType === SHOW_UPLOAD_JOB_TYPE;

  if (uploadStatus === Status.SUCCESS) {
    return isShowUploadJob;
  }

  if (uploadStatus === Status.ERROR) {
    return false;
  }

  if (
    uploadStatus === Status.WARNING ||
    uploadStatus === Status.NEXT ||
    uploadStatus === Status.WAITING
  ) {
    return false;
  }

  if (uav.errors?.includes(UAVErrorCode.INVALID_MISSION_CONFIGURATION)) {
    return false;
  }

  return false;
}

export function getPathUploadPillStyle(uploaded: boolean): CSSProperties {
  const backgroundColor = uploaded
    ? PATH_UPLOADED_COLOR
    : PATH_NOT_UPLOADED_COLOR;

  return {
    backgroundColor,
    color: createColor(backgroundColor).isLight() ? '#000' : '#fff',
  };
}

export function getPathUploadSemantics(uploaded: boolean): Status {
  return uploaded ? Status.SUCCESS : Status.ERROR;
}
