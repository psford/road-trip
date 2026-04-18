import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
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

export default config;
