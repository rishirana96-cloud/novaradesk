/* Shared presentation for analytics, report-builder and dashboard charts. */
(() => {
    if (!window.Chart) return;
    const family = '"Geist", "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
    const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
    const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
    const circularTypes = new Set(["doughnut", "pie", "polarArea"]);
    const totalLabels = { aiSentimentChart: "Conversations", humanReasonsChart: "Escalations", ticketStatusChart: "Tickets" };
    function polish(chart) {
        const options = chart.config.options;
        const light = document.documentElement.dataset.theme === "light";
        const text = light ? "#64748b" : "#a6b4c3";
        const strong = light ? "#23313f" : "#edf2f7";
        const grid = light ? "rgba(100,116,139,.12)" : "rgba(148,163,184,.12)";
        const surface = light ? "#ffffff" : "#17211d";
        const fontSize = ({ small: 10, default: 11, large: 12, xlarge: 14 })[document.documentElement.dataset.textSize] || 11;
        const circular = circularTypes.has(chart.config.type);
        options.layout ||= {};
        options.layout.padding = { top: 8, right: 8, bottom: 4, left: 0 };
        options.animation = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 280 };
        if (!circular) options.interaction = { ...options.interaction, mode: "index", intersect: false };
        options.plugins ||= {};
        const legend = options.plugins.legend;
        if (legend && legend !== false) {
            legend.position = circular ? "bottom" : "top";
            legend.align = circular ? "center" : "start";
            legend.labels ||= {};
            Object.assign(legend.labels, { color: text, usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 18, font: { family, size: fontSize, weight: "500" } });
        }
        if (options.plugins.tooltip !== false) {
            const tooltip = options.plugins.tooltip ||= {};
            Object.assign(tooltip, {
                backgroundColor: light ? "#1e293b" : "#edf2f7", titleColor: light ? "#ffffff" : "#1e293b",
                bodyColor: light ? "#e2e8f0" : "#334155", borderColor: light ? "#334155" : "#cbd5e1",
                borderWidth: 1, cornerRadius: 8, padding: 12, titleMarginBottom: 8, bodySpacing: 6,
                boxWidth: 7, boxHeight: 7, boxPadding: 5, usePointStyle: true,
                titleFont: { family, size: fontSize + 1, weight: "600" }, bodyFont: { family, size: fontSize },
                caretSize: 5, caretPadding: 8
            });
            tooltip.callbacks ||= {};
            if (!tooltip.callbacks.label) tooltip.callbacks.label = context => {
                const value = circular ? Number(context.raw) : Number(context.parsed[context.chart.options.indexAxis === "y" ? "x" : "y"]);
                if (!Number.isFinite(value)) return context.formattedValue;
                const label = circular ? context.label : context.dataset.label;
                let result = `${label ? `${label}: ` : ""}${number.format(value)}`;
                if (circular && context.chart.config.type !== "polarArea") {
                    const total = context.dataset.data.reduce((sum, item, index) => sum + (context.chart.getDataVisibility(index) ? Number(item) || 0 : 0), 0);
                    if (total > 0) result += ` · ${number.format(value / total * 100)}%`;
                }
                return result;
            };
        }
        if (!circular) Object.entries(options.scales || {}).forEach(([id, scale]) => {
            if (scale.display === false) return;
            const horizontal = (scale.axis || id.charAt(0)) === "x";
            scale.border = { ...scale.border, display: false };
            scale.grid = { ...scale.grid, color: grid, drawTicks: false, display: !horizontal };
            scale.ticks ||= {};
            Object.assign(scale.ticks, { color: text, padding: 10, maxRotation: 0, minRotation: 0, autoSkip: true, font: { family, size: fontSize } });
            if (!horizontal) {
                scale.ticks.maxTicksLimit = 5;
                if (!scale.ticks.callback) scale.ticks.callback = value => Math.abs(Number(value)) >= 1000 ? compact.format(Number(value)) : value;
            } else scale.ticks.maxTicksLimit = 8;
        });
        chart.data.datasets.forEach(dataset => {
            const type = dataset.type || chart.config.type;
            if (type === "bar") Object.assign(dataset, { borderWidth: 0, borderRadius: 3, maxBarThickness: 28, categoryPercentage: .7, barPercentage: .8 });
            if (type === "line") Object.assign(dataset, { borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 14, pointHoverBorderWidth: 2, pointHoverBorderColor: surface, tension: .25 });
            if (type === "doughnut" || type === "pie") Object.assign(dataset, { borderWidth: 3, borderColor: surface, hoverOffset: 4, borderRadius: 2 });
        });
        if (chart.config.type === "doughnut") options.cutout = "74%";
        chart.$presentation = { strong, text, family };
    }
    Chart.register({
        id: "novaraPresentation",
        beforeInit: polish,
        beforeUpdate: polish,
        afterDraw(chart) {
            const label = totalLabels[chart.canvas.id];
            if (!label || chart.config.type !== "doughnut") return;
            const dataset = chart.data.datasets[0];
            const labels = chart.data.labels || [];
            if (!dataset || labels.length !== dataset.data.length || labels.some(item => /^no\b/i.test(String(item)))) return;
            const visible = dataset.data.filter((_, index) => chart.getDataVisibility(index));
            const total = visible.reduce((sum, value) => sum + (Number(value) || 0), 0);
            const arc = chart.getDatasetMeta(0).data.find((_, index) => chart.getDataVisibility(index));
            if (!arc || !total || arc.innerRadius < 35) return;
            const ctx = chart.ctx, appearance = chart.$presentation;
            ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillStyle = appearance.strong;
            const size = Math.min(28, arc.innerRadius * .42);
            ctx.font = `600 ${size}px ${family}`;
            const value = compact.format(total);
            if (ctx.measureText(value).width < arc.innerRadius * 1.6) ctx.fillText(value, arc.x, arc.y - 9);
            ctx.fillStyle = appearance.text; ctx.font = `400 ${Math.min(11, arc.innerRadius * .17)}px ${family}`;
            ctx.fillText(label, arc.x, arc.y + 15); ctx.restore();
        }
    });
})();
