/* charts.js — Chart.js 图表渲染（由 templates/dashboard.html 拆分） */

let chartInstance = null;
        let powerChartInstance = null;
        let hrChartInstance = null;
        let topElevationChartInstance = null;
        let topDistanceChartInstance = null;
        let analysisChartInstances = {};

        // 图表分析筛选条件（运动类型在页面间保持选中）
        let chartSportType = '';

        function renderChart(labels, series, metric) {
            const ctx = document.getElementById('chartCanvas').getContext('2d');
            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }

            const values = (series[metric] || []).map(v => Number(v) || 0);
            const isLine = metric === 'elevation_gain_m';
            const label = metricLabels[metric] || metric;

            // 渐变色背景
            const gradient = ctx.createLinearGradient(0, 0, 0, 380);
            gradient.addColorStop(0, 'rgba(252, 76, 2, 0.45)');
            gradient.addColorStop(1, 'rgba(252, 76, 2, 0.05)');

            const cfg = {
                type: isLine ? 'line' : 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: label,
                        data: values,
                        backgroundColor: isLine ? gradient : 'rgba(252, 76, 2, 0.75)',
                        borderColor: '#fc4c02',
                        borderWidth: 2,
                        borderRadius: isLine ? 0 : 6,
                        borderSkipped: false,
                        fill: isLine,
                        tension: isLine ? 0.35 : 0,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: '#fc4c02',
                        pointBorderWidth: 2,
                        pointRadius: isLine ? 4 : 0,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle',
                                boxWidth: 8,
                                font: { size: 12 }
                            }
                        },
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
                                    const idx = context.dataIndex;
                                    const distance = series.distance_km
                                        ? Number(series.distance_km[idx] || 0).toFixed(2)
                                        : '-';
                                    const elevation = series.elevation_gain_m
                                        ? Number(series.elevation_gain_m[idx] || 0).toFixed(0)
                                        : '-';
                                    return [
                                        `${label}: ${context.parsed.y}`,
                                        `距离: ${distance} km`,
                                        `爬升: ${elevation} m`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: '#666', font: { size: 12 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0, 0, 0, 0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: {
                                display: true,
                                text: label,
                                color: '#999',
                                font: { size: 12 }
                            }
                        }
                    }
                }
            };

            chartInstance = new Chart(ctx, cfg);
        }

        function renderPowerDist(data) {
            const ctx = document.getElementById('powerDistCanvas').getContext('2d');
            if (powerChartInstance) {
                powerChartInstance.destroy();
                powerChartInstance = null;
            }

            const labels = data.labels || [];
            const hours = (data.hours || []).map(v => Number(v) || 0);
            const counts = (data.counts || []).map(v => Number(v) || 0);
            const curve = (data.curve || []).map(v => Number(v) || 0);

            if (!labels.length) {
                // 没有功率数据时清空画布
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            const gradient = ctx.createLinearGradient(0, 0, 0, 280);
            gradient.addColorStop(0, 'rgba(252, 76, 2, 0.7)');
            gradient.addColorStop(1, 'rgba(252, 76, 2, 0.15)');

            powerChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            type: 'line',
                            label: '正态分布拟合',
                            data: curve,
                            borderColor: '#c23a00',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.4,
                            yAxisID: 'y',
                            order: 1
                        },
                        {
                            type: 'bar',
                            label: '活动时间',
                            data: hours,
                            backgroundColor: gradient,
                            borderColor: '#fc4c02',
                            borderWidth: 1,
                            borderRadius: 4,
                            borderSkipped: false,
                            yAxisID: 'y',
                            order: 2
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } }
                        },
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
                                    if (ctx.dataset.type === 'line') {
                                        return `正态分布拟合: ${ctx.parsed.y} h`;
                                    }
                                    const count = counts[idx] !== undefined ? counts[idx] : '-';
                                    return [
                                        `活动时间: ${ctx.parsed.y} h`,
                                        `活动数量: ${count}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: '#666', font: { size: 11 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: { display: true, text: '活动时间 (h)', color: '#999', font: { size: 12 } }
                        }
                    }
                }
            });
        }

        function renderHRZones(data) {
            const ctx = document.getElementById('hrZoneCanvas').getContext('2d');
            if (hrChartInstance) {
                hrChartInstance.destroy();
                hrChartInstance = null;
            }

            const labels = data.labels || [];
            const hours = (data.hours || []).map(v => Number(v) || 0);
            const counts = (data.counts || []).map(v => Number(v) || 0);

            if (!labels.length) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            const gradient = ctx.createLinearGradient(0, 0, 0, 280);
            gradient.addColorStop(0, 'rgba(66, 153, 225, 0.7)');
            gradient.addColorStop(1, 'rgba(66, 153, 225, 0.15)');

            hrChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '活动时间',
                        data: hours,
                        backgroundColor: gradient,
                        borderColor: '#3182ce',
                        borderWidth: 1,
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
                                    return [
                                        `活动时间: ${ctx.parsed.y} h`,
                                        `活动数量: ${count}`
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: '#666', font: { size: 12 } }
                        },
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 12 } },
                            title: { display: true, text: '活动时间 (h)', color: '#999', font: { size: 12 } }
                        }
                    }
                }
            });
        }

        function _truncateName(name, maxLen = 22) {
            if (!name) return '-';
            if (name.length <= maxLen) return name;
            return name.slice(0, maxLen) + '…';
        }

        function _buildTopActivityTooltip(activity) {
            return [
                `距离: ${formatDistance(activity.distance)}`,
                `爬升: ${formatElevation(activity.total_elevation_gain)}`,
                `移动时间: ${formatTime(activity.moving_time)}`,
                `平均速度: ${formatSpeed(activity.average_speed)}`,
                `平均心率: ${formatHeartRate(activity.average_heartrate)}`,
                `最大功率: ${formatWatts(activity.average_watts)}`,
                `开始时间: ${formatActivityDate(activity)}`
            ];
        }

        function renderTopElevation(data) {
            const ctx = document.getElementById('topElevationCanvas').getContext('2d');
            if (topElevationChartInstance) {
                topElevationChartInstance.destroy();
                topElevationChartInstance = null;
            }

            const items = Array.isArray(data) ? data : [];
            if (items.length === 0) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            // 横柱状图：最高的在最上面，所以数组反转为升序，配合 y reverse
            const chartData = [...items].reverse();
            const labels = chartData.map(a => _truncateName(a.name));
            const values = chartData.map(a => a.total_elevation_gain || 0);

            const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
            gradient.addColorStop(0, 'rgba(34, 197, 94, 0.55)');
            gradient.addColorStop(1, 'rgba(34, 197, 94, 0.9)');

            topElevationChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '爬升 (m)',
                        data: values,
                        backgroundColor: gradient,
                        borderColor: '#16a34a',
                        borderWidth: 1,
                        borderRadius: 5,
                        borderSkipped: false
                    }]
                },
                options: {
                    indexAxis: 'y',
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
                                title: (ctx) => ctx[0] ? items[items.length - 1 - ctx[0].dataIndex].name : '',
                                label: (ctx) => _buildTopActivityTooltip(items[items.length - 1 - ctx.dataIndex])
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 11 } },
                            title: { display: true, text: '爬升 (m)', color: '#999', font: { size: 12 } }
                        },
                        y: {
                            grid: { display: false },
                            ticks: { color: '#555', font: { size: 12 } },
                            reverse: true
                        }
                    }
                }
            });
        }

        function renderTopDistance(data) {
            const ctx = document.getElementById('topDistanceCanvas').getContext('2d');
            if (topDistanceChartInstance) {
                topDistanceChartInstance.destroy();
                topDistanceChartInstance = null;
            }

            const items = Array.isArray(data) ? data : [];
            if (items.length === 0) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                return;
            }

            const chartData = [...items].reverse();
            const labels = chartData.map(a => _truncateName(a.name));
            const values = chartData.map(a => (a.distance || 0) / 1000);

            const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
            gradient.addColorStop(0, 'rgba(252, 76, 2, 0.55)');
            gradient.addColorStop(1, 'rgba(252, 76, 2, 0.9)');

            topDistanceChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '距离 (km)',
                        data: values,
                        backgroundColor: gradient,
                        borderColor: '#e04400',
                        borderWidth: 1,
                        borderRadius: 5,
                        borderSkipped: false
                    }]
                },
                options: {
                    indexAxis: 'y',
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
                                title: (ctx) => ctx[0] ? items[items.length - 1 - ctx[0].dataIndex].name : '',
                                label: (ctx) => _buildTopActivityTooltip(items[items.length - 1 - ctx.dataIndex])
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: { color: 'rgba(0,0,0,0.05)' },
                            ticks: { color: '#666', font: { size: 11 } },
                            title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } }
                        },
                        y: {
                            grid: { display: false },
                            ticks: { color: '#555', font: { size: 12 } },
                            reverse: true
                        }
                    }
                }
            });
        }

        // --- 活动流数据分析 ---
        function destroyAnalysisCharts() {
            Object.values(analysisChartInstances).forEach(chart => {
                if (chart) chart.destroy();
            });
            analysisChartInstances = {};
            destroyActivityRouteMap();
        }

        function _analysisDistanceLabels(distance_km) {
            return (distance_km || []).map(d => Number(d).toFixed(1));
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
            analysisChartInstances.elevation = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '海拔 (m)',
                        data: altitudes,
                        borderColor: '#16a34a',
                        backgroundColor: gradient,
                        borderWidth: 2,
                        fill: true,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '海拔 (m)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderHRCurve(data) {
            const ctx = document.getElementById('hrCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const hr = (data.heartrate || []).map(v => Number(v) || 0);
            const avg = data.summary && data.summary.avg_heartrate ? Number(data.summary.avg_heartrate) : null;
            const avgData = avg !== null ? hr.map(() => avg) : [];
            analysisChartInstances.hr = new Chart(ctx, {
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
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
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
            analysisChartInstances.speed = new Chart(ctx, {
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
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
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
            analysisChartInstances.power = new Chart(ctx, {
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
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#999', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderHRPowerOverlay(data) {
            const ctx = document.getElementById('hrPowerCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const hr = (data.heartrate || []).map(v => Number(v) || 0);
            const watts = (data.watts || []).map(v => Number(v) || 0);
            analysisChartInstances.hrPower = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '心率 (bpm)',
                            data: hr,
                            borderColor: '#ef4444',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            yAxisID: 'y'
                        },
                        {
                            label: '功率 (W)',
                            data: watts,
                            borderColor: '#f97316',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#ef4444', font: { size: 12 } }, title: { display: true, text: '心率 (bpm)', color: '#ef4444', font: { size: 12 } } },
                        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#f97316', font: { size: 12 } }, title: { display: true, text: '功率 (W)', color: '#f97316', font: { size: 12 } } }
                    }
                }
            });
        }

        function renderElevationGrade(data) {
            const ctx = document.getElementById('elevationGradeCanvas').getContext('2d');
            const labels = _analysisDistanceLabels(data.distance_km);
            const altitude = (data.altitude || []).map(v => Number(v) || 0);
            const grade = (data.grade || []).map(v => Number(v) || 0);
            const climbs = data.summary && data.summary.climb_segments ? data.summary.climb_segments : [];
            // 高亮爬坡段：构造背景色数组
            const climbColors = grade.map((g, i) => {
                const km = Number(data.distance_km[i]) || 0;
                const inClimb = climbs.some(c => km >= c.start_km && km <= c.end_km);
                return g > 5 || inClimb ? 'rgba(239, 68, 68, 0.6)' : 'rgba(34, 197, 94, 0.25)';
            });
            analysisChartInstances.elevationGrade = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '坡度 (%)',
                            data: grade,
                            backgroundColor: climbColors,
                            borderWidth: 0,
                            yAxisID: 'y1'
                        },
                        {
                            type: 'line',
                            label: '海拔 (m)',
                            data: altitude,
                            borderColor: '#16a34a',
                            backgroundColor: 'rgba(34, 197, 94, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            tension: 0.3,
                            fill: false,
                            yAxisID: 'y'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 6, font: { size: 11 } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11 } }, title: { display: true, text: '距离 (km)', color: '#999', font: { size: 12 } } },
                        y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#16a34a', font: { size: 12 } }, title: { display: true, text: '海拔 (m)', color: '#16a34a', font: { size: 12 } } },
                        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#666', font: { size: 12 } }, title: { display: true, text: '坡度 (%)', color: '#666', font: { size: 12 } } }
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
            analysisChartInstances.hrZoneDist = new Chart(ctx, {
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
            renderElevationProfile(data);
            renderHRCurve(data);
            renderSpeedCurve(data);
            renderPowerCurve(data);
            renderHRPowerOverlay(data);
            renderElevationGrade(data);
            renderHRZoneDistribution(data);
        }
