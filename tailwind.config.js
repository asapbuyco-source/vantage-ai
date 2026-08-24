export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./pages/**/*.{js,ts,jsx,tsx}",
        "./App.tsx",
        "./index.tsx",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Rajdhani', 'system-ui', 'sans-serif'],
                display: ['Orbitron', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'monospace'],
            },
            colors: {
                vantage: {
                    bg: '#05070a',
                    bgElevated: '#0a0f16',
                    surface: '#0d1219',
                    surfaceHover: '#111823',
                    lightBg: '#f8fafc',
                    cyan: '#22d3ee',
                    purple: '#a855f7',
                    glass: 'rgba(255, 255, 255, 0.05)',
                    glassBorder: 'rgba(255, 255, 255, 0.1)',
                    glassHover: 'rgba(255, 255, 255, 0.09)',
                }
            },
            backgroundImage: {
                'vantage-mesh': 'radial-gradient(ellipse 80% 50% at 20% -10%, rgba(168,85,247,0.14), transparent), radial-gradient(ellipse 70% 50% at 80% -10%, rgba(34,211,238,0.12), transparent)',
                'vantage-mesh-light': 'radial-gradient(ellipse 80% 50% at 20% -10%, rgba(168,85,247,0.07), transparent), radial-gradient(ellipse 70% 50% at 80% -10%, rgba(34,211,238,0.06), transparent)',
                'vantage-gradient': 'linear-gradient(135deg, #22d3ee 0%, #a855f7 100%)',
                'vantage-gradient-soft': 'linear-gradient(135deg, rgba(34,211,238,0.15) 0%, rgba(168,85,247,0.15) 100%)',
            },
            boxShadow: {
                'glass': '0 8px 32px rgba(0, 0, 0, 0.35)',
                'glass-hover': '0 12px 40px rgba(0, 0, 0, 0.5)',
                'cyan-glow': '0 0 20px rgba(34, 211, 238, 0.25)',
                'purple-glow': '0 0 20px rgba(168, 85, 247, 0.25)',
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow': 'glow 2s ease-in-out infinite alternate',
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 5px #22d3ee, 0 0 10px #22d3ee' },
                    '100%': { boxShadow: '0 0 20px #a855f7, 0 0 30px #a855f7' },
                }
            }
        },
    },
    plugins: [],
}
