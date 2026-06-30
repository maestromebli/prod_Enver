/** Android-оболонка (WebView) — той самий вигляд, що PWA /operator.html у браузері. */
export function isNativeOperatorShell() {
  return Boolean(window.EnverNative) || /EnverOperator\/\d/i.test(navigator.userAgent);
}

/** Базовий маркер APK/WebView — без розмітки operator-client. */
export function markEnverNativeShell() {
  if (!isNativeOperatorShell()) return;
  document.documentElement.classList.add("operator-pwa-capable", "enver-native-shell");
  document.body.classList.add("enver-native-shell");
}

export function markNativeOperatorShell() {
  if (!isNativeOperatorShell()) return;
  markEnverNativeShell();
  document.body.classList.add("enver-operator-ui", "operator-client-mode");
}
