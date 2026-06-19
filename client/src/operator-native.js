/** Android-оболонка (WebView) — той самий вигляд, що PWA /operator.html у браузері. */
export function isNativeOperatorShell() {
  return Boolean(window.EnverNative) || /EnverOperator\/\d/i.test(navigator.userAgent);
}

export function markNativeOperatorShell() {
  if (!isNativeOperatorShell()) return;
  document.documentElement.classList.add("operator-pwa-capable", "enver-native-shell");
  document.body.classList.add("enver-operator-ui", "operator-client-mode", "enver-native-shell");
}
