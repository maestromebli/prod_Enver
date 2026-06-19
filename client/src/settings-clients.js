import { api } from "./api.js";
import { escapeHtml } from "./utils.js";

let clientsInfo = null;

export async function loadClientsInfo() {
  clientsInfo = await api.getClientsInfo();
}

export function clientsSectionHtml() {
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
  const downloadUrl =
    clientsInfo?.androidDownloadUrl || `${origin}/downloads/enver-operator-android.apk`;
  const downloadReady = Boolean(clientsInfo?.androidDownloadAvailable);
  const installUrl = clientsInfo?.androidInstallUrl || `${origin}/android-install.html`;

  return `
    <div class="settings-section">
      <h2>Клієнти для цеху</h2>
      <p class="settings-hint">
        Застосунок для операторів станків на планшетах Android: повноекранна панель біля станка.
      </p>

      <article class="clients-card">
        <h3>Android (планшет / телефон)</h3>
        <p class="settings-hint">
          Завантажте APK, встановіть на планшет і вкажіть адресу сервера ENVER при першому запуску.
          Після входу — повноекранний режим; вихід лише кнопкою «Вийти з повноекранного» і паролем
          <code>1111</code>.
        </p>
        ${
          downloadReady
            ? `<a class="btn btn-primary" href="${escapeHtml(downloadUrl)}" download="enver-operator-android.apk">
                Завантажити застосунок для Android
              </a>`
            : `<p class="form-error">APK ще не зібрано. На сервері виконайте: <code>npm run build:android-client</code></p>
               <a class="btn" href="${escapeHtml(downloadUrl)}">Спробувати завантажити</a>`
        }
        <div class="clients-link-row">
          <input
            class="clients-url-input"
            id="androidDownloadUrl"
            type="text"
            readonly
            value="${escapeHtml(downloadUrl)}"
          />
          <button type="button" class="btn" data-copy-client-url="androidDownloadUrl">Копіювати</button>
        </div>
        <p class="settings-hint">
          Альтернатива без APK: <a href="${escapeHtml(installUrl)}">встановлення через Chrome (PWA)</a>.
        </p>
        <ol class="clients-steps">
          <li>Завантажте APK на планшет Android (кнопка вище або скопіюйте посилання).</li>
          <li>Дозвольте установку з невідомих джерел для браузера або файлового менеджера.</li>
          <li>Відкрийте «ENVER Оператор» і вкажіть URL сервера (наприклад <code>https://enver.example.com</code>).</li>
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
