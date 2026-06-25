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
  /** id замовлень з розгорнутим списком позицій у реєстрі */
  expandedOrderIds: new Set(),
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
  operatorQueueLoading: false,
  /** queue | scan — режим панелі оператора */
  operatorViewMode: "queue",
  /** Зведення цеху з /api/production/floor */
  productionFloor: null,
  productionFloorLoading: false,
  installCalendar: {
    /** calendar | list */
    displayMode: "calendar",
    view: "month",
    anchor: null,
    installerFilter: ""
  },
  godmodeNotifications: { items: [], fetchedAt: null },
  ordersView: {
    /** cards | list */
    displayMode: "cards",
    /** overview | pos-{id} | finance | history */
    detailTab: "overview",
    positionBundles: {},
    positionSubTab: {},
    positionTabDownstream: {},
    orderFinanceSummary: null,
    /** Фільтр пріоритету на реєстрі замовлень */
    priorityFilter: ""
  },
  constructorDesk: {
    orders: [],
    positions: [],
    constructors: [],
    detail: null,
    selectedOrderId: null,
    selectedPositionId: null,
    loading: false,
    onlyMine: false,
    error: "",
    stale: false,
    filter: "all"
  }
};
