export const state = {
  orders: [],
  positions: [],
  kpis: null,
  directories: {},
  history: [],
  historyEntityFilter: "",
  /** Порожній рядок — усі етапи на вкладці «Виробництво за етапами» */
  productionStageFilter: "",
  activeTab: "Дашборд",
  loading: false,
  /** id основних позицій, у яких розгорнуті підпозиції */
  expandedPositionIds: new Set(),
  /** main | settings | operator */
  view: "main",
  /** Куди повернутись після закриття обмежених налаштувань (напр. сповіщення з панелі оператора). */
  settingsReturnView: null,
  settingsSection: "users",
  currentUser: null,
  authToken: null,
  operatorStage: null,
  operatorQueue: [],
  operatorActiveSession: null,
  machineProgress: 0,
  machineProgressMessage: "",
  machineMatch: null,
  operatorSelectedPositionId: null,
  operatorJobDetail: null,
  operatorCuttingEstimate: null,
  machinePositionProgress: null,
  installCalendar: {
    /** calendar | list */
    displayMode: "calendar",
    view: "month",
    anchor: null,
    installerFilter: ""
  }
};
