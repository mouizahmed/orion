import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import electron from 'vite-plugin-electron/simple';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var production = mode === 'production';
    var read = function (name, developmentValue) {
        var _a;
        if (developmentValue === void 0) { developmentValue = ''; }
        var value = (_a = env[name]) === null || _a === void 0 ? void 0 : _a.trim();
        if (value)
            return value;
        if (production)
            throw new Error("".concat(name, " is required for a production build"));
        return developmentValue;
    };
    var supabaseConfig = {
        url: read('SUPABASE_URL', 'https://njzmleaestfbhdamyitd.supabase.co'),
        publishableKey: read('SUPABASE_PUBLISHABLE_KEY'),
        authCallbackUrl: read('AUTH_CALLBACK_URL', production ? 'https://orion.app/auth/callback' : 'http://localhost:3000/auth/callback'),
    };
    var apiBaseUrl = read('VITE_API_BASE_URL', 'http://localhost:8080/api');
    var parsedApiBaseUrl = new URL(apiBaseUrl);
    if ((parsedApiBaseUrl.protocol !== 'http:' && parsedApiBaseUrl.protocol !== 'https:')
        || parsedApiBaseUrl.username !== ''
        || parsedApiBaseUrl.password !== ''
        || parsedApiBaseUrl.search !== ''
        || parsedApiBaseUrl.hash !== ''
        || (production && (parsedApiBaseUrl.protocol !== 'https:'
            || ['localhost', '127.0.0.1', '::1'].includes(parsedApiBaseUrl.hostname.toLowerCase())))) {
        throw new Error('VITE_API_BASE_URL must use a non-loopback HTTPS origin for a production build');
    }
    var electronMainDefine = {
        __SUPABASE_CONFIG__: JSON.stringify(supabaseConfig),
    };
    return {
        base: './',
        define: {
            'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl),
        },
        plugins: [
            react(),
            tailwindcss(),
            electron({
                main: {
                    entry: 'electron/main.ts',
                    vite: { define: electronMainDefine },
                },
                preload: { input: path.join(__dirname, 'electron/preload.ts') },
                renderer: {},
            }),
        ],
        resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    };
});
