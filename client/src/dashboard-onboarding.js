import {
  canEditOrders,
  canViewConstructorDesk,
  canViewProcurement,
  isAdmin,
  isProductionHead
} from "./auth.js";
import { ATTENTION_TAB, CONSTRUCTOR_DESK_TAB, OVERVIEW_TAB, PROCUREMENT_TAB } from "./constants.js";

const DISMISS_PREFIX = "enver_dashboard_onboarding_dismissed_";

export function dashboardPersona() {
  if (isProductionHead()) return "production";
  if (canViewConstructorDesk() && !canEditOrders()) return "constructor";
  if (canViewProcurement() && !canEditOrders() && !canViewConstructorDesk()) return "procurement";
  if (canEditOrders()) return "manager";
  if (isAdmin()) return "admin";
  return "default";
}

const PERSONA_CONTENT = {
  manager: {
    title: "Ви менеджер",
    lead: "Ведіть замовлення від клієнта до передачі в цех.",
    steps: ["Створіть замовлення", "Додайте позиції", "Слідкуйте за «Потребує уваги»"],
    primaryNav: "Замовлення",
    primaryLabel: "До замовлень"
  },
  production: {
    title: "Ви начальник виробництва",
    lead: "Контролюйте черги, етапи та блокери по всьому цеху.",
    steps: [
      "«Потребує уваги» — пріоритети",
      "«Цех зараз» — черги та сесії",
      "Призначте конструкторів"
    ],
    primaryNav: ATTENTION_TAB,
    primaryLabel: "Що потребує уваги"
  },
  constructor: {
    title: "Ви конструктор",
    lead: "Працюйте з призначеними позиціями та пакетами конструктива.",
    steps: ["Відкрийте «Конструктори»", "Завантажте пакет", "Передайте в виробництво"],
    primaryNav: CONSTRUCTOR_DESK_TAB,
    primaryLabel: "Стіл конструктора"
  },
  procurement: {
    title: "Ви закупівельник",
    lead: "Календар MTO, склад і рекламації — в одній вкладці.",
    steps: ["Перевірте календар MTO", "Прийміть на склад", "Закрийте рекламації"],
    primaryNav: PROCUREMENT_TAB,
    primaryLabel: "До закупівель"
  },
  admin: {
    title: "Адміністратор",
    lead: "Огляд системи, користувачі та налаштування.",
    steps: ["Огляд показників", "Замовлення та позиції", "Налаштування → користувачі"],
    primaryNav: OVERVIEW_TAB,
    primaryLabel: "Огляд"
  },
  default: {
    title: "Ласкаво просимо",
    lead: "Замовлення → позиції → етапи до монтажу.",
    steps: ["Огляд показників", "Реєстр замовлень", "Цех і монтажі"],
    primaryNav: OVERVIEW_TAB,
    primaryLabel: "Почати"
  }
};

export function getDashboardOnboardingContent() {
  const persona = dashboardPersona();
  return { persona, ...PERSONA_CONTENT[persona] };
}

export function isDashboardOnboardingDismissed(persona = dashboardPersona()) {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(`${DISMISS_PREFIX}${persona}`) === "1";
  } catch {
    return false;
  }
}

export function dismissDashboardOnboarding(persona = dashboardPersona()) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${persona}`, "1");
  } catch {
    /* ignore */
  }
}

/** @deprecated залишено для зворотної сумісності */
export function migrateLegacyOnboardingDismiss() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem("enver_dashboard_onboarding_dismissed") !== "1") return;
    for (const key of Object.keys(PERSONA_CONTENT)) {
      localStorage.setItem(`${DISMISS_PREFIX}${key}`, "1");
    }
    localStorage.removeItem("enver_dashboard_onboarding_dismissed");
  } catch {
    /* ignore */
  }
}
