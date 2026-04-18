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
    contentInset: 'always'
  }
};

module.exports = config;
