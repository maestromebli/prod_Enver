import {
  canDelete3DAsset,
  canDownloadWebModel,
  canUpload3DAsset,
  canViewB3DReport,
  canViewOriginalB3D,
  canRetry3DConversion,
  canViewOrder3DTab
} from "@enver/shared/production/order-3d.js";
import { loadStoredUser } from "../auth.js";

export {
  canDelete3DAsset,
  canDownloadWebModel,
  canUpload3DAsset,
  canViewB3DReport,
  canViewOriginalB3D,
  canRetry3DConversion,
  canViewOrder3DTab
};

export function order3dUser() {
  return loadStoredUser();
}
