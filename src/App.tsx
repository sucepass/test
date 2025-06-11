import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import { FileUploader } from './components/FileUploader';
import enTranslations from '@shopify/polaris/locales/en.json';

function App() {
  return (
    <AppProvider i18n={enTranslations}>
      <div className="min-h-screen flex items-center justify-center p-5">
        <div className="w-96">
        <FileUploader />
        </div>
      </div>
    </AppProvider>
  );
}

export default App;
