/* maps.js — 线路热图（Leaflet）（由 templates/dashboard.html 拆分） */

// ============== 线路热图 ==============
        // 高德底图为 GCJ-02 坐标系，Strava 轨迹是 WGS-84，绘制前需要纠偏（见 wgs84ToGcj02）。
        const ROUTE_TILE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
        const ROUTE_TILE_SUBDOMAINS = '1234';
        const ROUTE_TILE_MAX_ZOOM = 18;
        const ROUTE_TILE_ATTRIBUTION = '&copy; <a href="https://www.amap.com/" target="_blank">高德地图</a>';
        const ROUTE_NEEDS_GCJ02 = true;
        // 统一使用蓝色系：单条轨迹按坡度由浅到深，热图页所有轨迹同一蓝色
        const ROUTE_COLOR = '#2563eb';
        const ROUTE_COLOR_DEEP = '#1e3a8a';
        const ROUTE_GRADE_BUCKETS = [
            { min: -Infinity, max: 0, color: '#93c5fd', label: '下坡 <0%' },
            { min: 0, max: 3, color: '#60a5fa', label: '平路 0-3%' },
            { min: 3, max: 6, color: '#3b82f6', label: '缓坡 3-6%' },
            { min: 6, max: 9, color: '#2563eb', label: '陡坡 6-9%' },
            { min: 9, max: Infinity, color: '#1e3a8a', label: '极陡 >9%' },
        ];

        let activityRouteMapInstance = null;
        let routeMapInstance = null;
        let routeMapLayerGroup = null;
        let routeMapFilters = { year: '', month: '', sportType: '' };

        // 切换页面时销毁地图实例，避免叶子节点残留
        function disposeRouteMaps() {
            if (typeof destroyActivityRouteMap === 'function') destroyActivityRouteMap();
            if (typeof destroySummaryRouteMap === 'function') destroySummaryRouteMap();
        }

        function routeGradeColor(grade) {
            // 缺坡度数据时退回标准蓝色，保证整条线仍是蓝色系
            if (grade === null || grade === undefined) return ROUTE_COLOR;
            const g = Number(grade);
            if (Number.isNaN(g)) return ROUTE_COLOR;
            for (const bucket of ROUTE_GRADE_BUCKETS) {
                if (g >= bucket.min && g < bucket.max) return bucket.color;
            }
            return ROUTE_GRADE_BUCKETS[ROUTE_GRADE_BUCKETS.length - 1].color;
        }

        function isLeafletReady() {
            return typeof L !== 'undefined' && L && typeof L.map === 'function';
        }

        // WGS-84 -> GCJ-02（国测局坐标），与高德瓦片对齐
        const GCJ02_A = 6378245.0;
        const GCJ02_EE = 0.00669342162296594323;

        function outOfChina(lat, lng) {
            return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
        }

        function transformLat(x, y) {
            let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
            ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
            ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
            ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
            return ret;
        }

        function transformLng(x, y) {
            let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
            ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
            ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
            ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
            return ret;
        }

        function wgs84ToGcj02(lat, lng) {
            if (outOfChina(lat, lng)) return [lat, lng];
            let dLat = transformLat(lng - 105.0, lat - 35.0);
            let dLng = transformLng(lng - 105.0, lat - 35.0);
            const radLat = lat / 180.0 * Math.PI;
            let magic = Math.sin(radLat);
            magic = 1 - GCJ02_EE * magic * magic;
            const sqrtMagic = Math.sqrt(magic);
            dLat = (dLat * 180.0) / ((GCJ02_A * (1 - GCJ02_EE)) / (magic * sqrtMagic) * Math.PI);
            dLng = (dLng * 180.0) / (GCJ02_A / sqrtMagic * Math.cos(radLat) * Math.PI);
            return [lat + dLat, lng + dLng];
        }

        function toMapCoord(point) {
            if (!Array.isArray(point) || point.length < 2) return null;
            const rawLat = point[0];
            const rawLng = point[1];
            if (rawLat === null || rawLat === undefined || rawLng === null || rawLng === undefined) return null;
            const lat = Number(rawLat);
            const lng = Number(rawLng);
            if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
            return ROUTE_NEEDS_GCJ02 ? wgs84ToGcj02(lat, lng) : [lat, lng];
        }

        function createRouteBaseMap(el, center, zoom) {
            // 轨迹数量可能上千条，用 Canvas 渲染比 SVG 快很多
            const map = L.map(el, { zoomControl: true, preferCanvas: true }).setView(center, zoom);
            L.tileLayer(ROUTE_TILE_URL, {
                subdomains: ROUTE_TILE_SUBDOMAINS,
                maxZoom: ROUTE_TILE_MAX_ZOOM,
                attribution: ROUTE_TILE_ATTRIBUTION
            }).addTo(map);
            return map;
        }

        function buildRouteLegendHtml() {
            const rows = ROUTE_GRADE_BUCKETS
                .map(b => `<div><i style="background:${b.color};"></i>${b.label}</div>`)
                .join('');
            return `${rows}<div><i style="background:${ROUTE_COLOR_DEEP};opacity:.45;"></i>爬坡段 (&gt;5%)</div>`;
        }

        // 相邻同色点合并成一条折线，避免为每个采样点都创建图层
        function drawGradedRoute(map, points, grades) {
            const groups = [];
            let current = null;
            for (let i = 1; i < points.length; i++) {
                const grade = (grades && grades[i] !== undefined) ? grades[i] : (grades ? grades[i - 1] : null);
                const color = routeGradeColor(grade);
                if (!current || current.color !== color) {
                    current = { color: color, coords: [points[i - 1], points[i]] };
                    groups.push(current);
                } else {
                    current.coords.push(points[i]);
                }
            }
            groups.forEach(group => {
                if (group.coords.length >= 2) {
                    L.polyline(group.coords, {
                        color: group.color,
                        weight: 4,
                        opacity: 0.9,
                        lineCap: 'round'
                    }).addTo(map);
                }
            });
        }

        function drawClimbHighlights(map, points, distances, climbs) {
            (climbs || []).forEach(climb => {
                const coords = [];
                for (let i = 0; i < points.length; i++) {
                    const d = distances ? distances[i] : null;
                    if (d === null || d === undefined) continue;
                    if (d >= climb.start_km && d <= climb.end_km) coords.push(points[i]);
                }
                if (coords.length < 2) return;
                L.polyline(coords, {
                    color: ROUTE_COLOR_DEEP,
                    weight: 9,
                    opacity: 0.28,
                    lineCap: 'round'
                }).addTo(map).bindTooltip(`爬坡 ${climb.start_km}-${climb.end_km} km`, { sticky: true });
                L.circleMarker(coords[0], {
                    radius: 5,
                    color: ROUTE_COLOR_DEEP,
                    fillColor: ROUTE_COLOR,
                    fillOpacity: 1,
                    weight: 2
                }).addTo(map).bindTooltip(`爬坡起点 ${climb.start_km} km`, { direction: 'top' });
            });
        }

        function drawStartEndMarkers(map, points) {
            L.circleMarker(points[0], {
                radius: 6, color: '#ffffff', fillColor: ROUTE_COLOR, fillOpacity: 1, weight: 2
            }).addTo(map).bindTooltip('起点', { direction: 'top' });
            L.circleMarker(points[points.length - 1], {
                radius: 6, color: '#ffffff', fillColor: ROUTE_COLOR_DEEP, fillOpacity: 1, weight: 2
            }).addTo(map).bindTooltip('终点', { direction: 'top' });
        }

        function destroyActivityRouteMap() {
            if (activityRouteMapInstance) {
                activityRouteMapInstance.remove();
                activityRouteMapInstance = null;
            }
        }

        function renderActivityRouteMap(data) {
            const el = document.getElementById('activityRouteMap');
            if (!el) return;
            destroyActivityRouteMap();
            el.innerHTML = '';

            // 逐点对齐：过滤掉缺失的坐标时，坡度和里程数组要同步过滤
            const points = [];
            const grades = [];
            const distances = [];
            (data.latlng || []).forEach((coord, i) => {
                const point = toMapCoord(coord);
                if (!point) return;
                points.push(point);
                grades.push((data.grade || [])[i] === undefined ? null : data.grade[i]);
                distances.push((data.distance_km || [])[i] === undefined ? null : data.distance_km[i]);
            });

            if (points.length < 2) {
                el.innerHTML = '<div class="route-map-fallback">该活动没有 GPS 轨迹（室内骑行或手动录入）</div>';
                return;
            }
            if (!isLeafletReady()) {
                el.innerHTML = '<div class="route-map-fallback">地图组件（Leaflet）加载失败，无法连接 jsdelivr CDN，请检查网络后刷新页面。</div>';
                return;
            }

            const map = createRouteBaseMap(el, points[0], 13);
            drawGradedRoute(map, points, grades);
            drawClimbHighlights(map, points, distances,
                (data.summary && data.summary.climb_segments) || []);
            drawStartEndMarkers(map, points);
            map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });

            const legend = document.createElement('div');
            legend.className = 'route-legend';
            legend.innerHTML = buildRouteLegendHtml();
            el.appendChild(legend);

            activityRouteMapInstance = map;
            setTimeout(() => map.invalidateSize(), 60);
        }

        // --- 线路热图页面（多轨迹汇总） ---
        const ROUTE_FETCH_BATCH = 30;   // 每批向 Strava 补抓的条数（后端单批上限 50）
        let routeMapLoading = false;

        function buildRouteMapControls() {
            const opts = getFilterOptions(allActivities);
            const yearOptions = opts.years
                .map(y => `<option value="${y}" ${routeMapFilters.year === String(y) ? 'selected' : ''}>${y} 年</option>`)
                .join('');
            const sportTypeOptions = Array.from(new Set([...opts.sportTypes, ...opts.types]))
                .sort()
                .map(t => `<option value="${escapeHtml(t)}" ${routeMapFilters.sportType === t ? 'selected' : ''}>${escapeHtml(t)}</option>`)
                .join('');

            return `
                <div class="filter-bar">
                    <div class="filter-group">
                        <label for="route-year">年份</label>
                        <select id="route-year">
                            <option value="">全部</option>
                            ${yearOptions}
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="route-month">月份</label>
                        <select id="route-month">
                            <option value="">全部</option>
                            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => `<option value="${m}" ${routeMapFilters.month === String(m) ? 'selected' : ''}>${m} 月</option>`).join('')}
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="route-sport-type">运动类型</label>
                        <select id="route-sport-type">
                            <option value="">全部</option>
                            ${sportTypeOptions}
                        </select>
                    </div>
                    <button class="btn-primary" onclick="applyRouteMapFilters()">查询</button>
                    <button class="btn-back" id="route-load-uncached" onclick="loadAllRoutes(this)">加载全部轨迹</button>
                </div>
                <div class="chart-card">
                    <div class="chart-title">线路热图（蓝色为骑过的路线，叠加越密颜色越深）</div>
                    <div id="routeMapContainer" class="route-map route-map-lg"></div>
                    <div class="route-map-note" id="routeMapStats">正在加载…</div>
                </div>
            `;
        }

        function destroySummaryRouteMap() {
            if (routeMapInstance) {
                routeMapInstance.remove();
                routeMapInstance = null;
            }
            routeMapLayerGroup = null;
        }

        function initRouteMapContainer() {
            const el = document.getElementById('routeMapContainer');
            if (!el) return;
            destroySummaryRouteMap();
            if (!isLeafletReady()) {
                el.innerHTML = '<div class="route-map-fallback">地图组件（Leaflet）加载失败，无法连接 jsdelivr CDN，请检查网络后刷新页面。</div>';
                return;
            }
            routeMapInstance = createRouteBaseMap(el, [35, 105], 4);
            routeMapLayerGroup = L.layerGroup().addTo(routeMapInstance);

            const legend = document.createElement('div');
            legend.className = 'route-legend';
            legend.innerHTML = `<div><i style="background:${ROUTE_COLOR};"></i>骑过的路线（叠加越密颜色越深）</div>`;
            el.appendChild(legend);

            setTimeout(() => routeMapInstance && routeMapInstance.invalidateSize(), 60);
        }

        function setRouteLoadButton(label, disabled) {
            const btn = document.getElementById('route-load-uncached');
            if (!btn) return;
            btn.textContent = label;
            btn.disabled = !!disabled;
        }

        function renderRouteHeatmap(data) {
            const statsEl = document.getElementById('routeMapStats');
            if (!document.getElementById('routeMapContainer')) return;
            if (!routeMapInstance) initRouteMapContainer();
            if (!routeMapInstance || !routeMapLayerGroup) {
                if (statsEl) statsEl.textContent = '地图不可用，无法绘制轨迹。';
                return;
            }

            routeMapLayerGroup.clearLayers();

            const routes = data.routes || [];
            const bounds = [];
            // 轨迹越多画得越淡，重叠处自然累积成更深的蓝色，形成热力效果
            const opacity = routes.length > 800 ? 0.10
                : routes.length > 300 ? 0.16
                : routes.length > 100 ? 0.24
                : 0.4;
            const weight = routes.length > 300 ? 2 : 3;

            routes.forEach(route => {
                const points = (route.points || []).map(toMapCoord).filter(Boolean);
                if (points.length < 2) return;
                L.polyline(points, {
                    color: ROUTE_COLOR,
                    weight: weight,
                    opacity: opacity,
                    lineCap: 'round'
                }).addTo(routeMapLayerGroup).bindTooltip(
                    `${escapeHtml(route.name || '')}<br>${formatActivityDate(route)}<br>${route.distance_km || 0} km`,
                    { sticky: true }
                );
                points.forEach(p => bounds.push(p));
            });

            if (bounds.length) {
                routeMapInstance.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
            }

            const stats = data.stats || {};
            if (statsEl) {
                const parts = [
                    `筛选到 ${stats.total || 0} 条活动`,
                    `已绘制 ${routes.length} 条`,
                ];
                if (stats.missing) parts.push(`待抓取 ${stats.missing} 条`);
                if (stats.without_gps) parts.push(`无 GPS ${stats.without_gps} 条`);
                if (stats.fetched) parts.push(`本次补抓 ${stats.fetched} 条`);
                if (stats.failed) parts.push(`失败 ${stats.failed} 条`);

                let note = parts.join(' · ');
                if (stats.rate_limited) {
                    note += '。Strava 接口配额已用尽（100 次/15 分钟），请等约 15 分钟后再次点击「加载全部轨迹」继续。';
                } else if (stats.missing && !routeMapLoading) {
                    note += '。点击「加载全部轨迹」会自动分批补齐剩余记录。';
                } else if (routeMapLoading) {
                    note += '。正在分批抓取中，可点「停止加载」中断。';
                }
                statsEl.textContent = note;
            }

            if (!routeMapLoading) {
                setRouteLoadButton('加载全部轨迹', !(stats.missing > 0));
            }
        }

        function buildRouteQuery(fetchCount) {
            const qs = [];
            if (routeMapFilters.year) qs.push('year=' + encodeURIComponent(routeMapFilters.year));
            if (routeMapFilters.month) qs.push('month=' + encodeURIComponent(routeMapFilters.month));
            if (routeMapFilters.sportType) qs.push('sport_type=' + encodeURIComponent(routeMapFilters.sportType));
            if (fetchCount) qs.push('fetch=' + fetchCount);
            return qs.length ? ('?' + qs.join('&')) : '';
        }

        async function requestRoutes(fetchCount = 0) {
            const statsEl = document.getElementById('routeMapStats');
            if (statsEl) {
                statsEl.textContent = fetchCount
                    ? `正在向 Strava 补抓轨迹（每批 ${fetchCount} 条）…`
                    : '正在加载轨迹…';
            }

            try {
                const res = await fetch('/map/routes' + buildRouteQuery(fetchCount));
                const data = await res.json();
                if (!res.ok) {
                    if (statsEl) statsEl.textContent = '获取失败: ' + (data.error || '未知错误');
                    return null;
                }
                return data;
            } catch (err) {
                if (statsEl) statsEl.textContent = '请求出错: ' + err.message;
                return null;
            }
        }

        async function fetchAndRenderRoutes(fetchCount = 0) {
            const data = await requestRoutes(fetchCount);
            if (data) renderRouteHeatmap(data);
            return data;
        }

        function applyRouteMapFilters() {
            routeMapLoading = false;
            routeMapFilters.year = document.getElementById('route-year').value;
            routeMapFilters.month = document.getElementById('route-month').value;
            routeMapFilters.sportType = document.getElementById('route-sport-type').value;
            fetchAndRenderRoutes(0);
        }

        // 一次点击连续分批抓取，直到抓完或触发 Strava 限流；再次点击可停止
        async function loadAllRoutes(btn) {
            if (routeMapLoading) {
                routeMapLoading = false;
                setRouteLoadButton('加载全部轨迹', false);
                return;
            }

            routeMapLoading = true;
            setRouteLoadButton('停止加载', false);

            let lastStats = null;
            try {
                while (routeMapLoading) {
                    const data = await fetchAndRenderRoutes(ROUTE_FETCH_BATCH);
                    if (!data) break;
                    lastStats = data.stats || {};
                    if (lastStats.rate_limited) break;
                    if (!lastStats.missing) break;
                    if (!lastStats.fetched) break;   // 本轮毫无进展，避免死循环
                }
            } finally {
                routeMapLoading = false;
                // 只有确认抓完才禁用按钮；中途失败/限流时保留入口便于重试
                setRouteLoadButton('加载全部轨迹', !!(lastStats && lastStats.missing === 0));
            }
        }

        async function loadRouteMap(btn) {
            setActiveMenu(btn);
            currentPageReload = () => loadRouteMap(btn);
            setLoading('线路热图（正在同步，请稍候）...');

            try {
                await ensureActivitiesSynced();
            } catch (err) {
                setError('线路热图', '活动同步失败: ' + err.message);
                return;
            }

            routeMapLoading = false;
            setHtml('线路热图', buildRouteMapControls());
            initRouteMapContainer();
            await fetchAndRenderRoutes(0);
        }
