import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Semânticos de estado (hubi): sucesso = signal, alerta = amber.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          // = amber-soft do design system (nome sem "amber" para não colidir
          // com a paleta âmbar do Tailwind).
          soft: "hsl(var(--amber) / var(--soft-alpha))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        login: {
          bg: "hsl(var(--login-bg))",
          input: {
            bg: "hsl(var(--login-input-bg))",
            border: "hsl(var(--login-input-border))",
          },
        },
        dashboard: {
          sidebar: "hsl(var(--dashboard-sidebar))",
          "sidebar-foreground": "hsl(var(--dashboard-sidebar-foreground))",
          surface: "hsl(var(--dashboard-surface))",
        },

        status: {
          open: {
            DEFAULT: "hsl(var(--status-open))",
            foreground: "hsl(var(--status-open-foreground))",
          },
          success: {
            DEFAULT: "hsl(var(--status-success))",
            foreground: "hsl(var(--status-success-foreground))",
          },
          "in-progress": {
            DEFAULT: "hsl(var(--status-in-progress))",
            foreground: "hsl(var(--status-in-progress-foreground))",
          },
          done: {
            DEFAULT: "hsl(var(--status-done))",
            foreground: "hsl(var(--status-done-foreground))",
          },
          new: {
            DEFAULT: "hsl(var(--status-new))",
            foreground: "hsl(var(--status-new-foreground))",
          },
        },

        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
          7: "hsl(var(--chart-7))",
          8: "hsl(var(--chart-8))",
          success: "hsl(var(--chart-success))",
          warning: "hsl(var(--chart-warning))",
          danger: "hsl(var(--chart-danger))",
          info: "hsl(var(--chart-info))",
          neutral: "hsl(var(--chart-neutral))",
          grid: "hsl(var(--chart-grid))",
          axis: "hsl(var(--chart-axis))",
          "mute-1": "hsl(var(--chart-mute-1))",
          "mute-2": "hsl(var(--chart-mute-2))",
          "mute-3": "hsl(var(--chart-mute-3))",
        },

        // Papéis hubi (design system). Os "-soft" são o tom a 10% (claro) /
        // 12% (escuro), via --soft-alpha.
        canvas: "hsl(var(--canvas))",
        surface: "hsl(var(--surface))",
        raised: "hsl(var(--raised))",
        subtle: "hsl(var(--subtle))",
        inverse: "hsl(var(--inverse))",
        scrim: "hsl(var(--scrim))",
        ink: {
          DEFAULT: "hsl(var(--ink))",
          secondary: "hsl(var(--ink-secondary))",
          tertiary: "hsl(var(--ink-tertiary))",
          disabled: "hsl(var(--ink-disabled))",
          inverse: "hsl(var(--ink-inverse))",
        },
        line: {
          DEFAULT: "hsl(var(--line))",
          strong: "hsl(var(--line-strong))",
          control: "hsl(var(--line-control))",
        },
        "primary-hover": "hsl(var(--primary-hover))",
        signal: {
          DEFAULT: "hsl(var(--signal))",
          soft: "hsl(var(--signal) / var(--soft-alpha))",
          foreground: "hsl(var(--on-signal))",
        },
        aqua: {
          DEFAULT: "hsl(var(--aqua))",
          soft: "hsl(var(--aqua) / var(--soft-alpha))",
        },
        ice: {
          DEFAULT: "hsl(var(--ice))",
          soft: "hsl(var(--ice) / var(--soft-alpha))",
        },
        coral: {
          DEFAULT: "hsl(var(--coral))",
          soft: "hsl(var(--coral) / var(--soft-alpha))",
        },
        amber: {
          DEFAULT: "hsl(var(--amber))",
          soft: "hsl(var(--amber) / var(--soft-alpha))",
        },

        // Bloco de notas do agente (papel pautado)
        notepad: {
          paper: "hsl(var(--notepad-paper))",
          rule: "hsl(var(--notepad-rule))",
          margin: "hsl(var(--notepad-margin))",
        },

        // shadcn sidebar semantic tokens (mapped to dashboard identity)
        sidebar: "hsl(var(--sidebar))",
        "sidebar-foreground": "hsl(var(--sidebar-foreground))",
        "sidebar-accent": "hsl(var(--sidebar-accent))",
        "sidebar-hover": "hsl(var(--sidebar-hover))",
        "sidebar-accent-foreground": "hsl(var(--sidebar-accent-foreground))",
        "sidebar-border": "hsl(var(--sidebar-border))",
        "sidebar-ring": "hsl(var(--sidebar-ring))",
      },
      // Texto semântico usa o tom de texto (AA no claro); bg/border/ring
      // continuam no tom exato do design system.
      textColor: {
        signal: { DEFAULT: "hsl(var(--signal-text))", foreground: "hsl(var(--on-signal))" },
        success: { DEFAULT: "hsl(var(--signal-text))", foreground: "hsl(var(--success-foreground))" },
        aqua: { DEFAULT: "hsl(var(--aqua-text))" },
        ice: { DEFAULT: "hsl(var(--ice-text))" },
        info: { DEFAULT: "hsl(var(--ice-text))", foreground: "hsl(var(--info-foreground))" },
        coral: { DEFAULT: "hsl(var(--coral-text))" },
        destructive: { DEFAULT: "hsl(var(--coral-text))", foreground: "hsl(var(--destructive-foreground))" },
        // A paleta âmbar padrão do Tailwind continua disponível para texto.
        amber: { ...defaultColors.amber, DEFAULT: "hsl(var(--amber-text))" },
        warning: { DEFAULT: "hsl(var(--amber-text))", foreground: "hsl(var(--warning-foreground))" },
      },
      // Raios hubi: lg = cards/popovers (10px), md = botões/inputs (6px),
      // sm = checkbox/chip (4px), xl = dialogs/sheets (14px).
      borderRadius: {
        xl: "var(--radius-lg)",
        lg: "var(--radius-md)",
        md: "var(--radius-sm)",
        sm: "var(--radius-xs)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-lg)",
        "2xl": "var(--shadow-lg)",
        glow: "var(--glow-signal)",
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
