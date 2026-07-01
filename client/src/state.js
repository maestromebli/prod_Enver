export const state = {
  orders: [],
  positions: [],
  kpis: null,
  directories: {},
  history: [],
  historyEntityFilter: "",
  /** Порожній рядок — усі етапи на вкладці «Цех зараз» */
  productionStageFilter: "",
  /** Фільтри списків — джерело правди для пошуку/статусу/відповідального (не лише DOM). */
  listFilters: {
    search: "",
    status: "",
    responsible: ""
  },
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
  operatorStageEstimate: null,
  operatorLoadError: "",
  operatorQueueLoading: false,
  /** Перегляд архіву завершених задач на етапі (лише читання). */
  operatorShowArchive: false,
  /** Підказки з /api/operator/queue (auto-select, auto-start) */
  operatorAutomation: null,
  /** 3D збірка в панелі роботи — лише після скану або кнопки «3D модель». */
  operatorAssembly3dOpen: false,
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
    /** cards | list | positions */
    displayMode: "cards",
    /** overview | pos-{id} | history */
    detailTab: "overview",
    positionBundles: {},
    constructorAssignees: [],
    focusResponsiblesPositionId: null,
    positionSubTab: {},
    positionTabDownstream: {},
    order3dAssets: {},
    /** Фільтр пріоритету на реєстрі замовлень */
    priorityFilter: "",
    /** manager | floor | full — пресет колонок реєстру позицій */
    positionsColumnPreset: "manager",
    /** mine | overdue | problems | no_constructive */
    filterPreset: ""
  },
  showArchived: false,
  constructorDesk: {
    orders: [],
    positions: [],
    constructors: [],
    detail: null,
    packageDetail: null,
    packageLoading: false,
    /** work | package — підвкладки робочої сторінки конструктора */
    workspaceTab: "work",
    selectedOrderId: null,
    selectedPositionId: null,
    loading: false,
    onlyMine: false,
    error: "",
    stale: false,
    filter: "all",
    /** cards | list — перегляд реєстру замовлень у конструктиві */
    displayMode: "cards"
  },
  /** Робочий простір закупівлі */
  procurement: null
};
