export const state = {
  orders: [],
  positions: [],
  kpis: null,
  directories: {},
  history: [],
  historyEntityFilter: "",
  /** Порожній рядок — усі етапи на вкладці «Виробництво за етапами» */
  productionStageFilter: "",
  activeTab: "Замовлення",
  /** id замовлення на вкладці «Замовлення» (детальний вигляд); null — сітка карток */
  selectedOrderId: null,
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
  operatorSelectedPositionId: null,
  operatorJobDetail: null,
  operatorLoadError: "",
  installCalendar: {
    /** calendar | list */
    displayMode: "calendar",
    view: "month",
    anchor: null,
    installerFilter: ""
  },
  ordersView: {
    /** cards | list */
    displayMode: "cards"
  }
};
