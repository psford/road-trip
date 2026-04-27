/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.psford.roadtripmap',
  appName: 'Road Trip',
  webDir: 'src/bootstrap',
  server: {
    iosScheme: 'capacitor',
    cleartext: false
  },
  ios: {
    // 'automatic' lets WKWebView decide insets based on keyboard + status-bar
    // state. The previous 'always' setting compounded the keyboard-driven
    // page shift when an input was focused, so the page-header ended up
    // behind the iOS status bar / Dynamic Island.
    contentInset: 'automatic'
  },
  plugins: {
    Keyboard: {
      // 'body' shrinks the document body height when the keyboard appears
      // instead of letting WKWebView shift the entire viewport up. The
      // focused input still ends up above the keyboard (because the body
      // itself is now shorter), but elements outside the visible area
      // (page header, status bar) don't get pushed past the safe-area-inset.
      resize: 'body'
    }
  }
};

module.exports = config;
