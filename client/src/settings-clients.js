import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

let clientsInfo = null;

export async function loadClientsInfo() {
  clientsInfo = await api.getClientsInfo();
}

export function clientsSectionHtml() {
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  const installUrl = clientsInfo?.androidInstallUrl || `${origin}/android-install.html`;
  const operatorUrl = clientsInfo?.operatorUrl || `${origin}/operator.html`;

  return `
    <div class="settings-section">
      <h2>Клієнти для цеху</h2>
      <p class="settings-hint">
        Клієнт для операторів станків на планшетах Android: повноекранна PWA-панель біля станка.
      </p>

      <article class="clients-card">
        <h3>Android (планшет / телефон)</h3>
        <p class="settings-hint">
          Встановлення через Google Chrome — іконка «ENVER Оператор» на головному екрані.
          Після входу — повноекранний режим; вихід лише кнопкою «Вийти з повноекранного» і паролем
          <code>1111</code>.
        </p>
        <a class="btn btn-primary" href="${escapeHtml(installUrl)}">
          Відкрити сторінку установки
        </a>
        <div class="clients-link-row">
          <input
            class="clients-url-input"
            id="androidInstallUrl"
            type="text"
            readonly
            value="${escapeHtml(installUrl)}"
          />
          <button type="button" class="btn" data-copy-client-url="androidInstallUrl">Копіювати</button>
        </div>
        <div class="clients-link-row">
          <input
            class="clients-url-input"
            id="operatorPanelUrl"
            type="text"
            readonly
            value="${escapeHtml(operatorUrl)}"
          />
          <button type="button" class="btn" data-copy-client-url="operatorPanelUrl">Копіювати</button>
        </div>
        <ol class="clients-steps">
          <li>На планшеті Android відкрийте посилання установки в Chrome (кнопка або QR з адмін-панелі).</li>
          <li>Натисніть «Встановити застосунок» або меню Chrome → «Додати на головний екран».</li>
          <li>Запускайте ENVER лише з іконки на головному екрані, не з вкладки браузера.</li>
          <li>Увійдіть (наприклад <code>porizka</code> / <code>1234</code>).</li>
          <li>Після входу панель займе весь екран; для виходу — «Вийти з повноекранного» + пароль <code>1111</code>.</li>
        </ol>
      </article>
    </div>
  `;
}

let clientsActionsBound = false;

export function bindClientsActions() {
  if (clientsActionsBound) return;
  clientsActionsBound = true;

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy-client-url]");
    if (!btn) return;
    const id = btn.dataset.copyClientUrl;
    const input = document.getElementById(id);
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = "Скопійовано";
      setTimeout(() => {
        btn.textContent = "Копіювати";
      }, 2000);
    } catch {
      input.select();
      document.execCommand("copy");
    }
  });
}
