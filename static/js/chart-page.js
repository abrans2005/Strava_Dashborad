/* chart-page.js — 运动员资料与图表分析页（由 templates/dashboard.html 拆分） */

function buildZonesPanel(zonesData) {
            // zonesData 应为数组；兼容旧对象格式
            let zones = [];
            if (Array.isArray(zonesData)) {
                zones = zonesData;
            } else if (zonesData && typeof zonesData === 'object') {
                if (zonesData.error) {
                    return `<div class="zone-card"><div class="zone-empty" style="color:#c00;">获取失败：${escapeHtml(zonesData.error)}<br><small style="color:#888;">请尝试重新授权，并确认 Strava 应用已开启 <b>profile:read_all</b> 权限。</small></div></div>`;
                }
                zones = [];
            }

            zones = zones.filter(z => z && Array.isArray(z.distribution_buckets) && z.distribution_buckets.length > 0);
            if (zones.length === 0) {
                return `<div class="zone-card"><h3>心率 / 功率区间</h3><div class="zone-empty">暂无区间数据</div></div>`;
            }

            return zones.map(zone => {
                const type = zone.type || 'heart_rate';
                const title = type === 'power' ? '功率区间' : '心率区间';
                const unit = type === 'power' ? 'W' : 'bpm';
                const tag = type === 'power' ? 'Power' : 'Heart Rate';

                const buckets = zone.distribution_buckets
                    .map((b, i) => ({ ...b, index: i }))
                    .filter(b => b.max !== null || b.min !== null);

                if (buckets.length === 0) {
                    return `<div class="zone-card"><h3>${title} <span class="zone-type-tag">${tag}</span></h3><div class="zone-empty">暂无有效区间</div></div>`;
                }

                // 最后一个 bucket 的 max 可能为 null / -1，表示无上限
                const definedMaxes = buckets.map(b => b.max).filter(v => v !== null && v !== undefined && v !== -1);
                const globalMax = definedMaxes.length ? Math.max(...definedMaxes) : Math.max(...buckets.map(b => (b.min || 0)));
                const tail = Math.max(type === 'power' ? 50 : 10, Math.round(globalMax * 0.08));

                const displayBuckets = buckets.map(b => {
                    const min = b.min !== null && b.min !== undefined ? b.min : 0;
                    const hasMax = b.max !== null && b.max !== undefined && b.max !== -1;
                    const max = hasMax ? b.max : (globalMax + tail);
                    return { ...b, min, max, hasMax };
                });

                const minBase = Math.min(...displayBuckets.map(b => b.min));
                const totalRange = Math.max(...displayBuckets.map(b => b.max)) - minBase;
                const effectiveTotal = totalRange > 0 ? totalRange : 1;

                const segments = displayBuckets.map((b, i) => {
                    const width = ((b.max - b.min) / effectiveTotal) * 100;
                    const color = zoneColors[i % zoneColors.length];
                    const rangeText = b.hasMax ? `${b.min}-${b.max}` : `${b.min}+`;
                    // 在区间段上显示心率/功率上限数字
                    const label = width > 8 ? (b.hasMax ? String(b.max) : '+') : '';
                    const timeText = b.time ? ' · 时间 ' + formatTimeSeconds(b.time) : '';
                    return `<div class="zone-segment" style="flex:${Math.max(width, 1)};background:${color};" title="Z${i + 1}: ${rangeText} ${unit}${timeText}"><span class="segment-label">${label}</span></div>`;
                }).join('');

                const legend = displayBuckets.map((b, i) => {
                    const color = zoneColors[i % zoneColors.length];
                    const rangeText = b.hasMax ? `${b.min}-${b.max}` : `${b.min}+`;
                    const timeText = b.time ? formatTimeSeconds(b.time) : '-';
                    return `
                        <div class="zone-legend-item">
                            <div class="zone-dot" style="background:${color}"></div>
                            <span>Z${i + 1}: ${rangeText} ${unit}</span>
                            <span class="zone-time">${timeText}</span>
                        </div>
                    `;
                }).join('');

                const note = zone.source === 'estimated'
                    ? `<span style="font-size:12px;color:#3182ce;font-weight:600;margin-left:8px;">根据历史活动估算（最大心率约 ${escapeHtml(zone.estimated_max_hr)} bpm）</span>`
                    : (zone.custom_zones
                        ? '<span style="font-size:12px;color:#fc4c02;font-weight:600;margin-left:8px;">自定义区间</span>'
                        : '<span style="font-size:12px;color:#888;font-weight:600;margin-left:8px;">Strava 默认区间</span>');

                return `
                    <div class="zone-card">
                        <h3>${title} <span class="zone-type-tag">${tag}</span>${note}</h3>
                        <div class="zone-bar">${segments}</div>
                        <div class="zone-legend">${legend}</div>
                    </div>
                `;
            }).join('');
        }

        // 一行式运动员横幅：头像 + 名字 + 终身统计 + 心率区间速览（有数据才显示）
        function buildAthleteProfile(athlete, zonesData) {
            const fullName = escapeHtml(((athlete.firstname || '') + ' ' + (athlete.lastname || '')).trim()) || '运动员';
            const avatarUrl = athlete.profile_medium || athlete.profile || '';
            const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=fc4c02&color=fff&size=200`;
            const location = [athlete.city, athlete.state, athlete.country].filter(Boolean).join(', ');
            const joined = athlete.created_at ? formatCreatedAt(athlete.created_at) : '';
            const premiumBadge = athlete.premium
                ? '<span class="athlete-badge premium">Premium</span>'
                : '';

            // 终身统计来自本地缓存的活动（未加载时不显示）
            const acts = activitiesLoaded && Array.isArray(allActivities) ? allActivities : [];
            const lifetimeHtml = acts.length ? `
                <div class="profile-stat">
                    <span class="v">${acts.length.toLocaleString()}</span>
                    <span class="l">活动</span>
                </div>
                <div class="profile-stat">
                    <span class="v">${Math.round(acts.reduce((s, a) => s + (a.distance || 0), 0) / 1000).toLocaleString()} km</span>
                    <span class="l">累计距离</span>
                </div>
            ` : '';

            // 心率区间速览 chips（无数据时整个隐藏）
            const zones = Array.isArray(zonesData) ? zonesData : [];
            const hrZone = zones.find(z => z && z.type === 'heart_rate'
                && Array.isArray(z.distribution_buckets) && z.distribution_buckets.length > 0);
            let zoneChipsHtml = '';
            if (hrZone) {
                const chips = hrZone.distribution_buckets
                    .filter(b => b.max !== null || b.min !== null)
                    .map((b, i) => {
                        const hasMax = b.max !== null && b.max !== undefined && b.max !== -1;
                        const rangeText = hasMax ? `${b.min}-${b.max}` : `${b.min || 0}+`;
                        return `<span class="zone-chip"><i style="background:${zoneColors[i % zoneColors.length]}"></i>Z${i + 1} ${rangeText} bpm</span>`;
                    }).join('');
                zoneChipsHtml = `<div class="zone-chips">${chips}</div>`;
            }

            return `
                <div class="profile-banner">
                    <img src="${escapeHtml(avatarUrl)}" alt="avatar" class="profile-avatar" onerror="this.src='${fallbackAvatar}'">
                    <div class="profile-id">
                        <div class="profile-name">${fullName} ${premiumBadge}
                            <a class="profile-link" href="#/gear">装备里程 →</a>
                        </div>
                        <div class="profile-meta">
                            ${athlete.username ? '@' + escapeHtml(athlete.username) : ''}
                            ${location ? ' · 📍 ' + escapeHtml(location) : ''}
                            ${joined ? ' · 加入 ' + joined : ''}
                        </div>
                        ${zoneChipsHtml}
                    </div>
                    <div class="profile-stats">${lifetimeHtml}</div>
                </div>
            `;
        }

        // --- 图表分析 ---
        async function ensureActivitiesSynced(force = false) {
            if (activitiesLoaded && !force) return allActivities;
            if (activitiesSyncPromise) return activitiesSyncPromise;

            activitiesSyncPromise = (async () => {
                const res = await fetch('/activities?fields=' + ACTIVITY_REQUEST_FIELDS);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || '活动同步失败');
                if (!Array.isArray(data)) throw new Error('活动数据格式无效');
                allActivities = data;
                activitiesLoaded = true;
                // 全局筛选栏的运动类型选项依赖活动数据
                populateGlobalSportOptions();
                return data;
            })();

            try {
                return await activitiesSyncPromise;
            } finally {
                activitiesSyncPromise = null;
            }
        }

        function buildChartControls() {
            // 年份/月份/运动类型已由顶部全局筛选栏接管，这里只保留图表自身指标
            const metricValue = currentRoute && currentRoute.params.metric ? currentRoute.params.metric : 'distance_km';
            const chips = [
                { key: 'count', label: '次数' },
                { key: 'distance_km', label: '距离' },
                { key: 'moving_time_hours', label: '时长' },
                { key: 'elevation_gain_m', label: '爬升' },
            ].map(c => `
                <button class="metric-chip ${c.key === metricValue ? 'active' : ''}" data-metric="${c.key}">${c.label}</button>
            `).join('');

            return `
                <div id="athlete-profile-section"></div>
                <div class="section-title">概览</div>
                <div class="metric-chips" id="metric-chips">${chips}</div>
                <div id="chart-summary" class="summary-cards"></div>
                <div class="chart-card">
                    <div class="main-chart-head">
                        <div class="main-chart-title" id="main-chart-title">月度趋势</div>
                        <div class="main-chart-meta" id="main-chart-meta"></div>
                        <div class="main-chart-legend">
                            <span class="lg-item"><i class="lg-swatch lg-bar"></i>月度</span>
                            <span class="lg-item"><i class="lg-swatch lg-line"></i>12 月均值</span>
                        </div>
                    </div>
                    <div class="chart-wrapper">
                        <canvas id="chartCanvas"></canvas>
                    </div>
                </div>
                <div class="chart-card heat-card" id="heat-card">
                    <div class="chart-card-head">
                        <div class="chart-title">年度热力 <span class="chart-sub" id="heat-sub">每格一个月，颜色越深数值越高</span></div>
                        <div class="heat-legend" id="heat-legend"></div>
                    </div>
                    <div id="year-heatmap" class="year-heatmap"></div>
                </div>
                <div class="section-title">分布</div>
                <div class="chart-row" id="dist-row">
                    <div class="chart-card" id="power-dist-card">
                        <div class="chart-title" id="power-dist-title">平均功率分布</div>
                        <div class="chart-wrapper" style="height:280px;">
                            <canvas id="powerDistCanvas"></canvas>
                        </div>
                    </div>
                    <div class="chart-card" id="hr-zone-card">
                        <div class="chart-title" id="hr-zone-title">心率区间分布</div>
                        <div class="chart-wrapper" style="height:280px;">
                            <canvas id="hrZoneCanvas"></canvas>
                        </div>
                    </div>
                </div>
                <div class="section-title">排行榜</div>
                <div class="chart-row">
                    <div class="chart-card">
                        <div class="chart-card-head">
                            <div class="chart-title" id="top-elevation-title">骑行爬升 TOP20</div>
                            <button class="rank-toggle" onclick="toggleRankRows(this)">TOP20</button>
                        </div>
                        <div class="rank-list" id="topElevationList"></div>
                    </div>
                    <div class="chart-card">
                        <div class="chart-card-head">
                            <div class="chart-title" id="top-distance-title">骑行里程 TOP20</div>
                            <button class="rank-toggle" onclick="toggleRankRows(this)">TOP20</button>
                        </div>
                        <div class="rank-list" id="topDistanceList"></div>
                    </div>
                </div>
            `;
        }

        async function renderAthleteProfileSection() {
            const section = document.getElementById('athlete-profile-section');
            if (!section) return;

            try {
                const [athleteRes, zonesRes] = await Promise.all([
                    fetch('/athlete'),
                    fetch('/athlete/zones')
                ]);

                const athlete = athleteRes.ok ? await athleteRes.json() : null;
                const zonesData = zonesRes.ok
                    ? await zonesRes.json()
                    : { error: '获取心率区间失败' };

                if (athlete && athlete.error) {
                    section.innerHTML = `<div style="color:#c00;padding:12px 0;">运动员信息加载失败：${escapeHtml(athlete.error)}</div>`;
                    return;
                }

                if (athlete) {
                    section.innerHTML = buildAthleteProfile(athlete, zonesData);
                }
            } catch (e) {
                section.innerHTML = `<div style="color:#c00;padding:12px 0;">运动员信息加载失败：${escapeHtml(e.message)}</div>`;
                console.error('加载运动员信息失败:', e);
            }
        }

        async function loadAthleteProfileOnly(btn) {
            setActiveMenu(btn);
            setLoading('运动员信息');

            try {
                const [athleteRes, zonesRes] = await Promise.all([
                    fetch('/athlete'),
                    fetch('/athlete/zones')
                ]);

                const athlete = athleteRes.ok ? await athleteRes.json() : null;
                const zonesData = zonesRes.ok
                    ? await zonesRes.json()
                    : { error: '获取心率区间失败' };

                if (athlete && athlete.error) {
                    setError('运动员信息', '获取失败: ' + athlete.error);
                    return;
                }

                if (!athlete) {
                    setError('运动员信息', '未能获取运动员信息');
                    return;
                }

                setHtml('运动员信息', buildAthleteProfile(athlete, zonesData));
            } catch (err) {
                setError('运动员信息', '请求出错: ' + err.message);
            }
        }

        async function loadChart(btn) {
            setActiveMenu(btn);
            setLoading('图表分析');

            try {
                await ensureActivitiesSynced();
            } catch (err) {
                setError('图表分析', '活动同步失败: ' + err.message);
                return;
            }

            populateGlobalSportOptions();
            setHtml('图表分析', buildChartControls());

            await renderAthleteProfileSection();

            // 指标切换：chips 高亮 + 只更新 URL 参数与主图，不整页重载
            document.querySelectorAll('#metric-chips .metric-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('#metric-chips .metric-chip').forEach(b => {
                        b.classList.toggle('active', b === btn);
                    });
                    replaceParams({ metric: btn.dataset.metric });
                    fetchAndRenderStats(btn.dataset.metric);
                });
            });

            // 默认立即查询一次
            await fetchAndRenderStats(currentRoute.params.metric || 'distance_km');
        }

        function updateTopChartTitles(sportType) {
            const elevationTitle = document.getElementById('top-elevation-title');
            const distanceTitle = document.getElementById('top-distance-title');
            if (elevationTitle) {
                elevationTitle.textContent = sportType ? `${sportType} · 爬升 TOP20` : '骑行爬升 TOP20';
            }
            if (distanceTitle) {
                distanceTitle.textContent = sportType ? `${sportType} · 里程 TOP20` : '骑行里程 TOP20';
            }
        }

        async function fetchAndRenderStats(metric) {
            try {
                // 时间范围与运动类型来自顶部全局筛选栏（start/end + sport_type）
                const baseQs = globalDateQuery();

                const metricQs = [...baseQs, 'metric=' + encodeURIComponent(metric)];

                const mainUrl = '/chart?' + metricQs.join('&');
                const powerUrl = '/chart/power-distribution?' + baseQs.join('&');
                const hrUrl = '/chart/hr-zones?' + baseQs.join('&');
                const topElevationUrl = '/chart/top-elevation?' + baseQs.join('&');
                const topDistanceUrl = '/chart/top-distance?' + baseQs.join('&');

                const [mainRes, powerRes, hrRes, topElevationRes, topDistanceRes] = await Promise.all([
                    fetch(mainUrl),
                    fetch(powerUrl),
                    fetch(hrUrl),
                    fetch(topElevationUrl),
                    fetch(topDistanceUrl)
                ]);

                const [data, powerData, hrData, topElevationData, topDistanceData] = await Promise.all([
                    mainRes.json(),
                    powerRes.json(),
                    hrRes.json(),
                    topElevationRes.json(),
                    topDistanceRes.json()
                ]);

                if (!mainRes.ok) {
                    setError('图表分析', '获取失败: ' + (data.error || '未知错误'));
                    return;
                }

                updateTopChartTitles(globalFilters.sport);

                // 环比数据：本月 vs 上个自然月（运动类型跟随全局筛选，与对比页共用口径）
                let monthCompare = null;
                try {
                    const month = monthRange(0), prev = monthRange(1);
                    const sportQs = baseQs.filter(p => p.startsWith('sport_type='));
                    const cmpRes = await fetch('/compare?' + [
                        'start1=' + month.start, 'end1=' + month.end,
                        'start2=' + prev.start, 'end2=' + prev.end,
                        ...sportQs,
                    ].join('&'));
                    if (cmpRes.ok) monthCompare = await cmpRes.json();
                } catch (e) { /* 环比失败不阻塞主图 */ }

                const deltaRow = (cur, prev) => monthCompare
                    ? `<div class="delta">较上月 ${deltaHtml(cur, prev)}</div>`
                    : '';

                const summaryEl = document.getElementById('chart-summary');
                if (data.summary) {
                    const m1 = monthCompare ? monthCompare.range1.summary : null;
                    const m2 = monthCompare ? monthCompare.range2.summary : null;
                    summaryEl.innerHTML = `
                        <div class="metric-card">
                            <div class="label">运动次数</div>
                            <div class="value">${data.summary.count}</div>
                            ${deltaRow(m1 && m1.count, m2 && m2.count)}
                        </div>
                        <div class="metric-card">
                            <div class="label">总距离</div>
                            <div class="value">${data.summary.distance_km} km</div>
                            ${deltaRow(m1 && m1.distance_km, m2 && m2.distance_km)}
                        </div>
                        <div class="metric-card">
                            <div class="label">移动时长</div>
                            <div class="value">${data.summary.moving_time_hours} h</div>
                            ${deltaRow(m1 && m1.moving_time_hours, m2 && m2.moving_time_hours)}
                        </div>
                        <div class="metric-card">
                            <div class="label">总爬升</div>
                            <div class="value">${data.summary.elevation_gain_m} m</div>
                            ${deltaRow(m1 && m1.elevation_gain_m, m2 && m2.elevation_gain_m)}
                        </div>
                    `;
                } else {
                    summaryEl.innerHTML = '';
                }

                const labels = data.labels || [];
                // 后端现在返回每个时间点的全量指标序列，方便 tooltip 一并展示
                const series = data.series || { [metric]: data.values || [] };
                const values = (series[metric] || []).map(v => Number(v) || 0);

                if (!labels.length || !values.length) {
                    // 该筛选组合下没有数据：只清空主图，其余图表继续渲染，避免整页报错
                    ChartRegistry.destroy('main');
                    const emptyCtx = document.getElementById('chartCanvas').getContext('2d');
                    emptyCtx.clearRect(0, 0, emptyCtx.canvas.width, emptyCtx.canvas.height);
                    renderYearHeatmap([], {}, metric);
                } else {
                    const activeMetric = metric || data.metric || 'distance_km';
                    renderChart(labels, series, activeMetric);
                    renderYearHeatmap(labels, series, activeMetric);
                }

                // 分布区空态降级：无数据整卡隐藏，样本太少显示角标
                const powerHasData = powerRes.ok && Array.isArray(powerData.labels) && powerData.labels.length > 0;
                const hrHasData = hrRes.ok && Array.isArray(hrData.labels) && hrData.labels.length > 0;
                const distRow = document.getElementById('dist-row');
                const powerCard = document.getElementById('power-dist-card');
                const hrCard = document.getElementById('hr-zone-card');
                if (powerCard) powerCard.style.display = powerHasData ? '' : 'none';
                if (hrCard) hrCard.style.display = hrHasData ? '' : 'none';
                if (distRow) distRow.style.display = (powerHasData || hrHasData) ? '' : 'none';
                if (powerHasData) {
                    const samples = (powerData.counts || []).reduce((s, v) => s + (Number(v) || 0), 0);
                    const powerTitle = document.getElementById('power-dist-title');
                    if (powerTitle) {
                        const sub = powerData.mean != null
                            ? ` <span class="chart-sub">加权平均 ${powerData.mean} W · σ ${powerData.std} · ${samples} 次</span>`
                            : '';
                        const badge = samples < 5 ? '<span class="sample-badge">样本不足</span>' : '';
                        powerTitle.innerHTML = `平均功率分布${sub}${badge}`;
                    }
                }
                if (hrHasData) {
                    const hrTitle = document.getElementById('hr-zone-title');
                    if (hrTitle) {
                        const sub = hrData.pct_low != null && hrData.total_hours
                            ? ` <span class="chart-sub">${hrData.pct_low}% 时间在 Z1-Z2 有氧区</span>`
                            : '';
                        hrTitle.innerHTML = `心率区间分布${sub}`;
                    }
                }

                if (powerHasData) {
                    renderPowerDist(powerData);
                } else {
                    ChartRegistry.destroy('power');
                }
                if (hrHasData) {
                    renderHRZones(hrData);
                } else {
                    ChartRegistry.destroy('hr');
                }
                if (topElevationRes.ok) {
                    renderTopElevation(topElevationData);
                }
                if (topDistanceRes.ok) {
                    renderTopDistance(topDistanceData);
                }
            } catch (err) {
                setError('图表分析', '请求出错: ' + err.message);
            }
        }
