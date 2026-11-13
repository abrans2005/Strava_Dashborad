/* charts.js — Chart.js 全局主题、实例注册表与图表渲染（由 templates/dashboard.html 拆分） */

// 统一图表实例注册表：按 key 创建/替换/销毁，页面切换时不再逐个手动 destroy
const ChartRegistry = {
    _charts: new Map(),

    add(key, chart) {
        this.destroy(key);
        this._charts.set(key, chart);
        return chart;
    },

    destroy(key) {
        const chart = this._charts.get(key);
        if (chart) {
            chart.destroy();
            this._charts.delete(key);
        }
    },

    destroyGroup(prefix) {
        for (const key of [...this._charts.keys()]) {
            if (key.startsWith(prefix)) this.destroy(key);
        }
    },

    destroyAll() {
        for (const key of [...this._charts.keys()]) this.destroy(key);
    },
};

// 创建图表的统一入口：先销毁同名旧实例，再创建新图表。
// 销毁必须发生在 new Chart 之前——同一 canvas 重建时，旧实例若还挂着，
// Chart.js 会抛 "Canvas is already in use"。
function createChart(key, ctx, config) {
    ChartRegistry.destroy(key);
    const chart = new Chart(ctx, config);
    ChartRegistry._charts.set(key, chart);
    return chart;
}

// 全局主题：所有图表共享字体、legend、tooltip 与网格样式
(function applyChartTheme() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#5a636e';
    Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.06)';
    Chart.defaults.animation.duration = 350;
    Chart.defaults.plugins.legend.position = 'top';
    Chart.defaults.plugins.legend.align = 'end';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.plugins.legend.labels.boxWidth = 7;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(31, 35, 41, 0.92)';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
    Chart.defaults.plugins.tooltip.boxPadding = 4;
})();


        // 尾部滚动均值（默认 12 个月），用于十年趋势参考线
        function _rollingMean(values, window) {
            const out = [];
            let sum = 0;
            for (let i = 0; i < values.length; i++) {
                sum += values[i];
                if (i >= window) sum -= values[i - window];
                out.push(i >= window - 1 ? +(sum / window).toFixed(2) : null);
            }
            return out;
        }

        // 峰值标注：只在最高的那根柱上标数值，给眼睛一个锚点
        function _peakValuePlugin(values, formatter) {
            return {
                id: 'peakValue',
                afterDatasetsDraw(chart) {
                    const maxVal = Math.max(...values, 0);
                    if (!maxVal) return;
                    const idx = values.indexOf(maxVal);
                    const meta = chart.getDatasetMeta(0);
                    const el = meta && meta.data ? meta.data[idx] : null;
                    if (!el) return;
                    const { ctx } = chart;
                    ctx.save();
                    ctx.font = '700 11px -apple-system, "PingFang SC", sans-serif';
                    ctx.fillStyle = '#fc4c02';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(formatter(maxVal), el.x, el.y - 6);
                    ctx.restore();
                }
            };
        }

        function _metricUnit(metric) {
            return {
                count: ' 次',
                distance_km: ' km',
                moving_time_hours: ' h',
                elevation_gain_m: ' m'
            }[metric] || '';
        }

        function renderChart(labels, series, metric) {
            const ctx = document.getElementById('chartCanvas').getContext('2d');
            const values = (series[metric] || []).map(v => Number(v) || 0);
            const label = metricLabels[metric] || metric;
            const unit = _metricUnit(metric);

            // 年度交替配色：奇偶年深浅橙色交替，130 根密柱立刻有年度节奏
            const years = labels.map(l => String(l).slice(0, 4));
            const barColors = years.map(y => Number(y) % 2 === 0
                ? 'rgba(252, 76, 2, 0.78)'
                : 'rgba(252, 76, 2, 0.42)');

            // 12 个月滚动均值：十年趋势参考
            const trend = _rollingMean(values, 12);
            const hasTrend = labels.length >= 13;
            // x 轴是否含 1 月标签：决定年份标注策略
            const hasJan = labels.some(l => String(l).slice(5, 7) === '01');

            const cfg = {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: label + '（月度）',
                            data: values,
                            backgroundColor: barColors,
                            hoverBackgroundColor: 'rgba(252, 76, 2, 0.95)',
                            borderColor: 'transparent',
                            borderWidth: 0,
                            borderRadius: { topLeft: 2, topRight: 2, bottomLeft: 0, bottomRight: 0 },
                            borderSkipped: false,
                            maxBarThickness: 9,
                            categoryPercentage: 1,
                            barPercentage: 0.85,
                            order: 2
                        },
                        {
                            type: 'line',
                            label: '12 月均值',
                            data: trend,
                            borderColor: 'rgba(31, 35, 41, 0.32)',
                            borderWidth: 1.3,
                            borderDash: [4, 4],
                            pointRadius: 0,
                            pointHoverRadius: 0,
                            tension: 0.35,
                            spanGaps: true,
                            hidden: !hasTrend,
                            order: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(40, 40, 40, 0.9)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: {
                                title: function (context) {
                                    return context[0] ? context[0].label : '';
                                },
                                label: function (context) {
                                    if (context.dataset.type === 'line') {
                                        return `12 月均值: ${context.parsed.y}${unit}`;
                                    }
                                    const idx = context.dataIndex;
                                    const distance = series.distance_km
                                        ? Number(series.distance_km[idx] || 0).toFixed(2)
                                        : '-';
                                    const elevation = series.elevation_gain_m
                                        ? Number(series.elevation_gain_m[idx] || 0).toFixed(0)
                                        : '-';
                                    const lines = [
                                        `${label}: ${context.parsed.y}${unit}`,
                                        `距离: ${distance} km`,
                                        `爬升: ${elevation} m`
                                    ];
                                    if (trend[idx] !== null && trend[idx] !== undefined) {
                                        lines.push(`12 月均值: ${trend[idx]}${unit}`);
                                    }
                                    return lines;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: {
                                autoSkip: false,
                                maxRotation: 0,
                                color: '#8a919c',
                                font: { size: 11 },
                                // 只在每年 1 月标年份；数据不含 1 月时退回稀疏标注
                                callback(value, index) {
                                    const raw = String(this.getLabelForValue(value) || '');
                                    if (hasJan) {
                                        return raw.slice(5, 7) === '01' ? raw.slice(0, 4) : '';
                                    }
                                    return index % 6 === 0 ? raw : '';
                                }
                            }
                        },
                        y: {
                            beginAtZero: true,
                            grace: '12%',
                            grid: { color: 'rgba(0, 0, 0, 0.05)' },
                            ticks: { color: '#8a919c', font: { size: 11 }, maxTicksLimit: 6 },
                            title: {
                                display: true,
                                text: label,
                                color: '#b3bac3',
                                font: { size: 11 }
                            }
                        }
                    }
                },
                plugins: [
                    _peakValuePlugin(values, v => Math.round(v * 100) / 100 + unit)
                ]
            };

            createChart('main', ctx, cfg);

            // 卡片头部：当前指标总览（累计/月均/峰值）
            const titleEl = document.getElementById('main-chart-title');
            if (titleEl) titleEl.textContent = '月度趋势 · ' + label;
            const metaEl = document.getElementById('main-chart-meta');
            if (metaEl) {
                const total = values.reduce((s, v) => s + v, 0);
                const avg = labels.length ? total / labels.length : 0;
                let maxIdx = 0;
                values.forEach((v, i) => { if (v > values[maxIdx]) maxIdx = i; });
                const fmt = v => Math.round(v * 10) / 10;
                metaEl.textContent = values.length
                    ? `累计 ${fmt(total)}${unit} · 月均 ${fmt(avg)}${unit} · 峰值 ${fmt(values[maxIdx])}${unit}（${labels[maxIdx]}）`
                    : '';
            }
        }

        // ===== 年度热力矩阵（行=年，列=月） =====

        let _heatTipEl = null;

        function _heatTooltipEl() {
            if (!_heatTipEl) {
                _heatTipEl = document.createElement('div');
                _heatTipEl.className = 'heat-tip';
                document.body.appendChild(_heatTipEl);
            }
            return _heatTipEl;
        }

        // 点击格子：把全局筛选切到该月（复用筛选栏逻辑，联动所有图表）
        function openHeatMonth(label) {
            const year = Number(String(label).slice(0, 4));
            const month = Number(String(label).slice(5, 7));
            if (!year || !month) return;
            const from = `${year}-${pad2(month)}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const to = `${year}-${pad2(month)}-${pad2(lastDay)}`;
            updateGlobalFilters({ period: 'custom', from, to });
        }

        function _bindHeatmapEvents(wrap) {
            if (wrap.dataset.bound === '1') return;
            wrap.dataset.bound = '1';
            const tip = _heatTooltipEl();
            wrap.addEventListener('mousemove', e => {
                const cell = e.target.closest('.heat-cell[data-tip]');
                if (!cell) {
                    tip.classList.remove('show');
                    return;
                }
                tip.textContent = cell.dataset.tip;
                tip.classList.add('show');
                const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
                const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
                tip.style.left = x + 'px';
                tip.style.top = y + 'px';
            });
            wrap.addEventListener('mouseleave', () => tip.classList.remove('show'));
            wrap.addEventListener('click', e => {
                const cell = e.target.closest('.heat-cell[data-label]');
                if (cell) openHeatMonth(cell.dataset.label);
            });
        }

        function renderYearHeatmap(labels, series, metric) {
            const card = document.getElementById('heat-card');
            const wrap = document.getElementById('year-heatmap');
            if (!card || !wrap) return;
            if (!labels || !labels.length) {
                card.style.display = 'none';
                return;
            }
            card.style.display = '';

            const values = (series[metric] || []).map(v => Number(v) || 0);
            const unit = _metricUnit(metric);
            const metricName = metricLabels[metric] || metric;

            // 按年分组：每年 12 个格子，缺失月份留空
            const byYear = new Map();
            labels.forEach((label, i) => {
                const y = String(label).slice(0, 4);
                const m = Number(String(label).slice(5, 7));
                if (!byYear.has(y)) byYear.set(y, new Array(12).fill(null));
                byYear.get(y)[m - 1] = { value: values[i], label };
            });

            const maxVal = Math.max(...values, 0);
            // sqrt 压缩色阶：小值也可见，大值不被压平
            const heatAlpha = v => (maxVal && v > 0
                ? (0.14 + 0.8 * Math.sqrt(v / maxVal)).toFixed(3)
                : 0.06);

            const monthHead = Array.from({ length: 12 }, (_, i) =>
                `<span class="heat-month">${i + 1}</span>`).join('');

            const rows = [...byYear.entries()].map(([year, cells]) => {
                const cellHtml = cells.map((c, i) => {
                    if (!c) return '<span class="heat-cell"></span>';
                    const v = Math.round(c.value * 10) / 10;
                    const tip = `${year} 年 ${i + 1} 月 · ${v}${unit}`;
                    return `<button type="button" class="heat-cell" data-label="${c.label}"
                                data-tip="${tip}" style="--v:${heatAlpha(c.value)}"
                                aria-label="${tip}"></button>`;
                }).join('');
                return `<div class="heat-row">
                            <span class="heat-year">${year}</span>
                            <div class="heat-cells">${cellHtml}</div>
                        </div>`;
            }).join('');

            wrap.innerHTML = `
                <div class="heat-row heat-head">
                    <span class="heat-year"></span>
                    <div class="heat-cells">${monthHead}</div>
                </div>
                ${rows}
            `;
            _bindHeatmapEvents(wrap);

            const legend = document.getElementById('heat-legend');
            if (legend) {
                legend.innerHTML = '<span>少</span>' +
                    [0.2, 0.36, 0.52, 0.7, 0.9]
                        .map(a => `<i style="background:rgba(252,76,2,${a})"></i>`).join('') +
                    '<span>多</span>';
            }
            const sub = document.getElementById('heat-sub');
            if (sub) sub.textContent = `每格一个月，颜色越深${metricName}越高 · 点击格子查看该月`;
        }

        // ===== 分布图通用插件 =====

        // 柱顶数值：直接标在每根柱子上方，不用 hover 才能读
        function _barTopValuePlugin(datasetIndex, formatter) {
            return {
                id: 'barTopValue' + datasetIndex,
                afterDatasetsDraw(chart) {
                    const meta = chart.getDatasetMeta(datasetIndex);
                    const ds = chart.data.datasets[datasetIndex];
                    if (!meta || !ds || !Array.isArray(ds.data)) return;
                    const { ctx } = chart;
                    ctx.save();
                    ctx.font = '600 10px -apple-system, "PingFang SC", sans-serif';
                    ctx.fillStyle = '#8a919c';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    meta.data.forEach((el, i) => {
                        const v = Number(ds.data[i]);
                        if (!v) return;
                        ctx.fillText(formatter(v, i), el.x, el.y - 4);
                    });
                    ctx.restore();
                }
            };
        }

        // 连续正态分布曲线：按公式在 120 个采样点上绘制（淡红填充 + 虚线）
        // 用连续采样替代「每个区间一个点」的折线，避免少量桶时的失真弧线
        function _normalCurvePlugin(opts) {
            return {
                id: 'normalCurve',
                beforeDatasetsDraw(chart) {
                    const { mean, std, binStart, binWidth, totalHours } = opts || {};
                    if (!mean || !std || std <= 0 || !totalHours) return;
                    const n = (chart.data.labels || []).length;
                    if (n < 5) return; // 桶太少时拟合无意义，直接不画

                    const { ctx, chartArea, scales } = chart;
                    const x = scales.x;
                    const y = scales.y;
                    const px0 = x.getPixelForValue(0);
                    const span = x.getPixelForValue(n - 1) - px0;
                    const coef = 1 / (std * Math.sqrt(2 * Math.PI));
                    const clampY = py => Math.max(chartArea.top, Math.min(chartArea.bottom, py));

                    const pts = [];
                    const steps = 120;
                    for (let i = 0; i <= steps; i++) {
                        const binIdx = (i / steps) * (n - 1);
                        const watts = binStart + (binIdx + 0.5) * binWidth;
                        const hours = coef * Math.exp(-((watts - mean) ** 2) / (2 * std * std))
                            * totalHours * binWidth;
                        pts.push([px0 + (binIdx / (n - 1)) * span, clampY(y.getPixelForValue(hours))]);
                    }

                    ctx.save();
                    // 面积填充
                    ctx.beginPath();
                    ctx.moveTo(pts[0][0], chartArea.bottom);
                    pts.forEach(([px, py]) => ctx.lineTo(px, py));
                    ctx.lineTo(pts[pts.length - 1][0], chartArea.bottom);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
                    ctx.fill();
                    // 曲线
                    ctx.beginPath();
                    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
                    ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 4]);
                    ctx.stroke();
                    ctx.restore();
                }
            };
        }

        function _formatHours(h) {
            return h >= 10 ? Math.round(h) + 'h' : Number(h).toFixed(1) + 'h';
        }

        function renderPowerDist(data) {
            const ctx = document.getElementById('powerDistCanvas').getContext('2d');
            const labels = data.labels || [];
            const hours = (data.hours || []).map(v => Number(v) || 0);
            const counts = (data.counts || []).map(v => Number(v) || 0);

            if (!labels.length) {
                // 没有功率数据时清空画布
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            const totalHours = Number(data.total_hours) || hours.reduce((s, v) => s + v, 0);

            createChart('power', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '活动时间',
                        data: hours,
                        backgroundColor: 'rgba(252, 76, 2, 0.55)',
                        hoverBackgroundColor: 'rgba(252, 76, 2, 0.85)',
                        borderColor: 'transparent',
                        borderWidth: 0,
                        borderRadius: 4,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 18 } },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(40, 40, 40, 0.9)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: {
                                title: (ctx) => '功率区间: ' + (ctx[0] ? ctx[0].label : ''),
                                label: (ctx) => {
                                    const idx = ctx.dataIndex;
                                    const count = counts[idx] !== undefined ? counts[idx] : '-';
                                    const pct = totalHours ? Math.round(hours[idx] / totalHours * 100) : 0;
                                    return [
                                        `活动时间: ${ctx.parsed.y} h（${pct}%）`,
                                        `活动数量: ${count}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { maxRotation: 0, color: '#666', font: { size: 11 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: { display: true, text: '活动时间 (h)', color: '#999', font: { size: 12 } }
                        }
                    }
                },
                plugins: [
                    _normalCurvePlugin({
                        mean: Number(data.mean) || 0,
                        std: Number(data.std) || 0,
                        binStart: Number(data.bin_start) || 0,
                        binWidth: Number(data.bin_width) || 25,
                        totalHours: totalHours
                    }),
                    _barTopValuePlugin(0, v => _formatHours(v))
                ]
            });
        }

        function renderHRZones(data) {
            const ctx = document.getElementById('hrZoneCanvas').getContext('2d');
            const labels = data.labels || [];
            const hours = (data.hours || []).map(v => Number(v) || 0);
            const counts = (data.counts || []).map(v => Number(v) || 0);
            const pct = data.pct || [];

            if (!labels.length) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            // Z1-Z5 语义色：与分析页心率区间条保持一致（蓝→绿→黄→橙→红）
            const zoneColors = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];
            const colors = labels.map((_, i) => zoneColors[i % zoneColors.length]);
            const totalHours = Number(data.total_hours) || hours.reduce((s, v) => s + v, 0);

            createChart('hr', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '活动时间',
                        data: hours,
                        backgroundColor: colors.map(c => c + 'cc'),
                        hoverBackgroundColor: colors,
                        borderColor: 'transparent',
                        borderWidth: 0,
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 18 } },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(40, 40, 40, 0.9)',
                            titleFont: { size: 13 },
                            bodyFont: { size: 13 },
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: {
                                title: (ctx) => '心率区间: ' + (ctx[0] ? ctx[0].label : ''),
                                label: (ctx) => {
                                    const idx = ctx.dataIndex;
                                    const count = counts[idx] !== undefined ? counts[idx] : '-';
                                    const share = pct[idx] !== undefined
                                        ? pct[idx]
                                        : (totalHours ? Math.round(hours[idx] / totalHours * 100) : 0);
                                    return [
                                        `活动时间: ${ctx.parsed.y} h（${share}%）`,
                                        `活动数量: ${count}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { maxRotation: 0, color: '#666', font: { size: 11 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: { display: true, text: '活动时间 (h)', color: '#999', font: { size: 12 } }
                        }
                    }
                },
                plugins: [_barTopValuePlugin(0, v => _formatHours(v))]
            });
        }

        function _truncateName(name, maxLen = 22) {
            if (!name) return '-';
            if (name.length <= maxLen) return name;
            return name.slice(0, maxLen) + '…';
        }

        // --- 排行榜：HTML 列表（奖牌、迷你条、可点击进分析） ---
        function _rankRowHtml(item, index, maxVal, valueNum, valueText, tone) {
            const d = activityStartDate(item);
            const dateStr = d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
            const meta = [dateStr, item.sport_type || item.type].filter(Boolean).join(' · ');
            const pct = maxVal > 0 ? Math.max(1.5, (valueNum / maxVal) * 100) : 0;
            const rankCls = index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : '';
            return `
                <div class="rank-row${index >= 10 ? ' rank-extra' : ''}" onclick="openActivityAnalysis('${item.id}')">
                    <span class="rank-badge ${rankCls}">${index + 1}</span>
                    <span class="rank-info">
                        <span class="rank-name">${escapeHtml(_truncateName(item.name, 26))}</span>
                        ${meta ? `<span class="rank-meta">${escapeHtml(meta)}</span>` : ''}
                    </span>
                    <span class="rank-bar-wrap"><span class="rank-bar ${tone}" style="width:${pct.toFixed(1)}%;"></span></span>
                    <span class="rank-value">${valueText}</span>
                </div>
            `;
        }

        function _renderRankList(containerId, chartKey, items, valueNum, valueText, tone, emptyTitle) {
            const el = document.getElementById(containerId);
            if (!el) return;
            ChartRegistry.destroy(chartKey); // 清理旧 canvas 版本残留的实例

            if (!items.length) {
                el.innerHTML = buildStateBlock({
                    icon: 'empty',
                    title: emptyTitle,
                    desc: '当前筛选条件下没有可比的活动。',
                });
                const t = el.parentElement.querySelector('.rank-toggle');
                if (t) t.style.display = 'none';
                return;
            }

            const max = Math.max(...items.map(valueNum), 1);
            el.innerHTML = items
                .map((it, i) => _rankRowHtml(it, i, max, valueNum(it), valueText(it), tone))
                .join('');
            el.classList.remove('expanded');

            const btn = el.parentElement.querySelector('.rank-toggle');
            if (btn) {
                btn.style.display = items.length > 10 ? '' : 'none';
                btn.textContent = 'TOP20';
            }
        }

        function toggleRankRows(btn) {
            const list = btn.closest('.chart-card').querySelector('.rank-list');
            if (!list) return;
            const expanded = list.classList.toggle('expanded');
            btn.textContent = expanded ? '收起' : 'TOP20';
        }

        function renderTopElevation(data) {
            _renderRankList(
                'topElevationList', 'topElevation',
                Array.isArray(data) ? data : [],
                a => a.total_elevation_gain || 0,
                a => Math.round(a.total_elevation_gain || 0).toLocaleString() + ' m',
                'green',
                '暂无爬升排行'
            );
        }

        function renderTopDistance(data) {
            _renderRankList(
                'topDistanceList', 'topDistance',
                Array.isArray(data) ? data : [],
                a => a.distance || 0,
                a => ((a.distance || 0) / 1000).toFixed(1) + ' km',
                'orange',
                '暂无里程排行'
            );
        }

        // --- 活动流数据分析 ---
        function destroyAnalysisCharts() {
            ChartRegistry.destroyGroup('analysis:');
            destroyActivityRouteMap();
        }

        function _analysisDistanceLabels(distance_km) {
            return (distance_km || []).map(d => Number(d).toFixed(1));
        }

        // 爬坡段红色底纹插件：直接画在海拔剖面图上（替代独立的双轴联动图）
        function _climbBandPlugin(climbSegments, distanceKm) {
            return {
                id: 'climbBands',
                beforeDatasetsDraw(chart) {
                    if (!climbSegments || !climbSegments.length) return;
                    const { ctx, chartArea, scales } = chart;
                    const x = scales.x;
                    ctx.save();
                    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
                    climbSegments.forEach(c => {
                        const i0 = distanceKm.findIndex(d => d >= c.start_km);
                        const i1 = distanceKm.findIndex(d => d >= c.end_km);
                        if (i0 < 0 || i1 < 0 || i1 <= i0) return;
                        const px0 = x.getPixelForValue(i0);
                        const px1 = x.getPixelForValue(i1);
                        ctx.fillRect(px0, chartArea.top, px1 - px0, chartArea.bottom - chartArea.top);
                    });
                    ctx.restore();
                }
            };
        }

        function _mkAnalysisGradient(ctx, colorStart, colorEnd) {
            const gradient = ctx.createLinearGradient(0, 0, 0, 260);
            gradient.addColorStop(0, colorStart);
            gradient.addColorStop(1, colorEnd);
            return gradient;
        }

        function renderElevationProfile(data) {
            const ctx = document.getElementById('elevationCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const altitudes = (data.altitude || []).map(v => Number(v) || 0);
            const gradient = _mkAnalysisGradient(ctx, 'rgba(34, 197, 94, 0.5)', 'rgba(34, 197, 94, 0.05)');
            const climbs = (data.summary && data.summary.climb_segments) || [];
            // 段数仍很多时不画底纹（会把剖面刷成斑马纹），改用一条淡坡度线兜底
            const manyClimbs = climbs.length > 6;
            const datasets = [{
                label: '海拔 (m)',
                data: altitudes,
                borderColor: '#16a34a',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.3
            }];
            const scales = {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '海拔 (m)', color: '#999', font: { size: 12 } } }
            };
            if (manyClimbs) {
                datasets.push({
                    label: '坡度 (%)',
                    data: (data.grade || []).map(v => Number(v) || 0),
                    borderColor: 'rgba(148, 163, 184, 0.9)',
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    tension: 0.3,
                    fill: false,
                    yAxisID: 'yGrade'
                });
                scales.yGrade = { display: false, min: 0, max: 20 };
            }
            createChart('analysis:elevation', ctx, {
                type: 'line',
                data: { labels: labels, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: scales
                },
                plugins: manyClimbs ? [] : [_climbBandPlugin(climbs, data.distance_km || [])]
            });
        }

        function renderHRCurve(data) {
            const ctx = document.getElementById('hrCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const hr = (data.heartrate || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_heartrate ? Number(data.summary.avg_heartrate) : null;
            const avgData = avg !== null ? hr.map(() => avg) : [];
            createChart('analysis:hr', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '心率 (bpm)',
                            data: hr,
                            borderColor: '#ef4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: false
                        },
                        {
                            label: `平均心率 ${avg || '-'} bpm`,
                            data: avgData,
                            borderColor: '#ef4444',
                            borderWidth: 1,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '心率 (bpm)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderSpeedCurve(data) {
            const ctx = document.getElementById('speedCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const speed = (data.velocity_kmh || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_velocity_kmh ? Number(data.summary.avg_velocity_kmh) : null;
            const avgData = avg !== null ? speed.map(() => avg) : [];
            createChart('analysis:speed', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '速度 (km/h)',
                            data: speed,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.08)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.4,
                            fill: true
                        },
                        {
                            label: `平均速度 ${avg || '-'} km/h`,
                            data: avgData,
                            borderColor: '#3b82f6',
                            borderWidth: 1,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '速度 (km/h)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderPowerCurve(data) {
            const ctx = document.getElementById('powerCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const watts = (data.watts || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_watts ? Number(data.summary.avg_watts) : null;
            const avgData = avg !== null ? watts.map(() => avg) : [];
            if (!data.has_watts) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }
            createChart('analysis:power', ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '功率 (W)',
                            data: watts,
                            borderColor: '#f97316',
                            backgroundColor: 'rgba(249, 115, 22, 0.08)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: `平均功率 ${avg || '-'} W`,
                            data: avgData,
                            borderColor: '#f97316',
                            borderWidth: 1,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderHRZoneDistribution(data) {
            const ctx = document.getElementById('hrZoneCanvas').getContext('2d');
            const stats = data.hr_zone_stats || [];
            if (!stats.length) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }
            const labels = stats.map(s => `Z${s.zone}`);
            const hours = stats.map(s => s.hours);
            const pcts = stats.map(s => s.pct);
            const colors = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];
            createChart('analysis:hrZoneDist', ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '时长 (h)',
                        data: hours,
                        backgroundColor: colors.slice(0, hours.length),
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const s = stats[ctx.dataIndex];
                                    return [`时长: ${s.hours} h`, `占比: ${s.pct}%`, s.label];
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '时长 (h)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderAnalysisCharts(data) {
            destroyAnalysisCharts();
            renderActivityRouteMap(data);

            // 空态降级：无对应数据的卡整卡隐藏，不再留空白占位
            const hasAlt = (data.altitude || []).some(v => v !== null && v !== undefined);
            const hasHR = data.has_hr && (data.heartrate || []).some(v => v !== null);
            const hasWatts = data.has_watts && (data.watts || []).some(v => v !== null);
            const hasSpeed = (data.velocity_kmh || []).some(v => v !== null);
            const zoneStats = data.hr_zone_stats || [];
            _toggleAnalysisCard('elevationCard', hasAlt);
            _toggleAnalysisCard('hrCard', hasHR);
            _toggleAnalysisCard('powerCard', hasWatts);
            _toggleAnalysisCard('speedCard', hasSpeed);
            _toggleAnalysisCard('hrZoneCard', zoneStats.length > 0);

            if (hasAlt) renderElevationProfile(data);
            if (hasHR) renderHRCurve(data);
            if (hasSpeed) renderSpeedCurve(data);
            if (hasWatts) renderPowerCurve(data);
            if (zoneStats.length) renderHRZoneDistribution(data);
        }

        function _toggleAnalysisCard(id, show) {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? '' : 'none';
        }
