/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PLATFORM_API_URL: string;
  readonly VITE_PUBLISHABLE_KEY: string;
  readonly VITE_API_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_DEV_LOGIN?: string;
  readonly VITE_HELPLINE_URL?: string;
}
