export const READY_STATUS = "Готово до встановлення";
export const ON_INSTALL_STATUS = "На встановленні";

export function isInstallRelevant(position) {
  return Boolean(
    position.installDate ||
    position.positionStatus === READY_STATUS ||
    position.positionStatus === ON_INSTALL_STATUS
  );
}
